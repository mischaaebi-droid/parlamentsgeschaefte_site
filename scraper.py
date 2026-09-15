from playwright.sync_api import sync_playwright
import requests
import json
import re
import time
from pathlib import Path
from datetime import datetime, timezone

CURIA_URL = "https://www.parlament.ch/de/ratsbetrieb/suche-curia-vista"
API_URL = "https://ws-old.parlament.ch/affairs/{}"

ANZAHL_AKTUALISIEREN = 400
TREFFER_PRO_SEITE = 10
PAUSE_API = 0.30

DATA_DIR = Path("data")
DATEI = DATA_DIR / "geschaefte.json"


def hole_aktuelle_geschaefte():
    """Liest die neuesten Geschäfte in der Reihenfolge von Curia Vista."""
    print("Öffne Curia Vista ...")

    alle = []
    gesehen = set()
    anzahl_seiten = (ANZAHL_AKTUALISIEREN + TREFFER_PRO_SEITE - 1) // TREFFER_PRO_SEITE

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        for seite in range(anzahl_seiten):
            start = seite * TREFFER_PRO_SEITE + 1
            url = f"{CURIA_URL}#k=#s={start}#l=1033"
            responses = []

            def handle_response(response):
                if "ProcessQuery" in response.url:
                    try:
                        responses.append(response.text())
                    except Exception:
                        pass

            page.on("response", handle_response)

            print(f"Curia Vista Seite {seite + 1}/{anzahl_seiten} (Treffer ab {start}) ...")
            page.goto(url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(1200)

            if not responses:
                print(f"Warnung: Seite {seite + 1} lieferte keine Daten.")
                page.remove_listener("response", handle_response)
                continue

            text = responses[-1]

            # Die Felder stehen in der Curia-Vista-Antwort direkt hintereinander.
            affairs = re.findall(
                r'"PdAffairId":"(\d+)",'
                r'"PdAffairIdFormatted":"([^"]+)",'
                r'"PdAffairTypeId":"([^"]*)",'
                r'"PdAffairTypeName":"([^"]*)"',
                text
            )

            neu_auf_seite = 0
            for affair_id, formatted_id, type_id, type_name in affairs:
                if affair_id in gesehen:
                    continue

                gesehen.add(affair_id)
                alle.append({
                    "id": int(affair_id),
                    "formatted_id": formatted_id,
                    "type_id": type_id,
                    "type_name": type_name,
                    "curia_rank": len(alle) + 1,
                })
                neu_auf_seite += 1

                if len(alle) >= ANZAHL_AKTUALISIEREN:
                    break

            print(f"  {neu_auf_seite} Geschäfte gefunden")
            page.remove_listener("response", handle_response)

            if len(alle) >= ANZAHL_AKTUALISIEREN:
                break

        browser.close()

    if not alle:
        raise RuntimeError("Keine aktuellen Geschäfte in Curia Vista gefunden.")

    print(f"{len(alle)} aktuelle Geschäfte gefunden.")
    return alle[:ANZAHL_AKTUALISIEREN]


def lade_archiv():
    if not DATEI.exists():
        return []

    with DATEI.open("r", encoding="utf-8") as f:
        daten = json.load(f)

    if not isinstance(daten, list):
        raise RuntimeError(f"{DATEI} enthält keine JSON-Liste.")

    return daten


def hole_detail(affair):
    affair_id = affair["id"]
    r = requests.get(
        API_URL.format(affair_id),
        headers={"Accept": "application/json"},
        timeout=30,
    )

    if r.status_code != 200:
        print(f"FEHLER bei {affair['formatted_id']}: HTTP {r.status_code}")
        return None

    data = r.json()

    # Zusätzliche, stabile Felder für die Website.
    # Die vollständige Originalantwort der Parlaments-API bleibt erhalten.
    data["_site"] = {
        "formatted_id": affair["formatted_id"],
        "type_id": affair["type_id"],
        "type_name": affair["type_name"],
        "curia_rank": affair["curia_rank"],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }

    return data


def main():
    DATA_DIR.mkdir(exist_ok=True)

    aktuell = hole_aktuelle_geschaefte()
    archiv = lade_archiv()

    print(f"\nBisher im Archiv: {len(archiv)}")
    print(f"Aktualisiere die neuesten {len(aktuell)} Geschäfte vollständig ...\n")

    aktualisiert = []
    fehlgeschlagen = set()

    for nummer, affair in enumerate(aktuell, start=1):
        data = hole_detail(affair)

        if data is None:
            fehlgeschlagen.add(str(affair["id"]))
        else:
            aktualisiert.append(data)
            print(
                f"{nummer}/{len(aktuell)} OK: "
                f"{affair['formatted_id']} [{affair['type_name']}] - "
                f"{data.get('title', 'ohne Titel')}"
            )

        time.sleep(PAUSE_API)

    # Bestehende Version eines Datensatzes behalten, falls sein neuer Abruf
    # ausnahmsweise fehlgeschlagen ist. Sonst werden die neuesten 400 ersetzt.
    aktualisierte_ids = {str(x.get("id")) for x in aktualisiert}

    alte_nicht_ersetzte = [
        x for x in archiv
        if str(x.get("id")) not in aktualisierte_ids
    ]

    # Reihenfolge: zuerst die aktuellen Curia-Vista-Treffer,
    # danach das bisherige Archiv in seiner bisherigen Reihenfolge.
    gesamt = aktualisiert + alte_nicht_ersetzte

    # Sicherheitshalber Duplikate entfernen.
    eindeutig = []
    gesehen = set()
    for x in gesamt:
        affair_id = str(x.get("id"))
        if not affair_id or affair_id == "None" or affair_id in gesehen:
            continue
        gesehen.add(affair_id)
        eindeutig.append(x)

    tmp = DATEI.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(eindeutig, f, ensure_ascii=False, indent=2)

    tmp.replace(DATEI)

    print(f"\nFertig.")
    print(f"Neu abgerufen/überschrieben: {len(aktualisiert)}")
    print(f"Fehlgeschlagene Abrufe: {len(fehlgeschlagen)}")
    print(f"Gesamtbestand: {len(eindeutig)}")
    print(f"Datei: {DATEI}")


if __name__ == "__main__":
    main()
