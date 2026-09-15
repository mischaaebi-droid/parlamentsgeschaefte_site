const DATA_URL = "data/geschaefte.json";
const PAGE_SIZE = 40;
const PREVIEW_LENGTH = 400;

let allAffairs = [];
let filteredAffairs = [];
let visibleCount = PAGE_SIZE;
const openAffairs = new Set();

const typeFilter = document.querySelector("#typeFilter");
const searchInput = document.querySelector("#searchInput");
const resetButton = document.querySelector("#resetButton");
const resultCount = document.querySelector("#resultCount");
const updated = document.querySelector("#updated");
const results = document.querySelector("#results");
const moreButton = document.querySelector("#moreButton");

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (typeof value === "object") return Object.values(value).map(text).join(" ");
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripHtml(value) {
  const el = document.createElement("div");
  el.innerHTML = String(value ?? "");
  return (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim();
}

function getType(a) {
  return a?._site?.type_name || a?.affairType?.name || a?.type?.name || a?.affairTypeName || "Ohne Typ";
}

function getNumber(a) {
  return a?._site?.formatted_id || a?.shortId || a?.shortID || a?.number || a?.id || "";
}

function getTitle(a) {
  return a?.title || "Titel folgt";
}

function getState(a) {
  return a?.state?.name || a?.state || "";
}

function getCouncil(a) {
  return a?.priorityCouncil1?.name || a?.priorityCouncil1 || "";
}

function getAuthor(a) {
  const roles = a?.roles?.role || a?.roles || [];
  const list = Array.isArray(roles) ? roles : [roles];

  for (const role of list) {
    const candidate =
      role?.councillor?.fullName ||
      role?.councillor?.name ||
      role?.person?.fullName ||
      role?.name;

    if (candidate) return candidate;
  }
  return "";
}

/*
  Die Parlaments-API liefert die Texte als Sammlung.
  Gesucht wird ausdrücklich der Abschnitt "Eingereichter Text".
  Die Funktion ist absichtlich tolerant gegenüber leicht unterschiedlichen
  JSON-Strukturen.
*/
function getSubmittedText(a) {
  const containers = [
    a?.texts,
    a?.text,
    a?.affairTexts,
    a?.descriptions
  ].filter(Boolean);

  for (const container of containers) {
    const list = Array.isArray(container)
      ? container
      : Array.isArray(container?.text)
        ? container.text
        : Array.isArray(container?.texts)
          ? container.texts
          : Object.values(container);

    for (const item of list) {
      if (!item || typeof item !== "object") continue;

      const label = text(
        item.typeName ??
        item.type?.name ??
        item.name ??
        item.title ??
        item.textTypeName ??
        item.descriptionTypeName ??
        item.type
      ).toLocaleLowerCase("de-CH");

      if (
        label.includes("eingereichter text") ||
        label.includes("eingereicht") ||
        label.includes("submitted text")
      ) {
        const value =
          item.value ??
          item.text ??
          item.content ??
          item.description ??
          item.html;

        if (typeof value === "string" && value.trim()) return value;
      }
    }
  }

  return "";
}

function getPreview(html) {
  const plain = stripHtml(html);
  if (plain.length <= PREVIEW_LENGTH) return plain;

  let cut = plain.slice(0, PREVIEW_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > PREVIEW_LENGTH - 60) cut = cut.slice(0, lastSpace);

  return `${cut} …`;
}

function parliamentUrl(a) {
  const n = getNumber(a);
  return `https://www.parlament.ch/de/ratsbetrieb/suche-curia-vista/geschaeft?AffairId=${encodeURIComponent(n)}`;
}

function populateTypes() {
  const types = [...new Set(allAffairs.map(getType).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "de"));

  for (const type of types) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeFilter.appendChild(option);
  }
}

function applyFilters() {
  const wantedType = typeFilter.value;
  const q = searchInput.value.trim().toLocaleLowerCase("de-CH");

  filteredAffairs = allAffairs.filter(a => {
    if (wantedType && getType(a) !== wantedType) return false;
    if (!q) return true;
    return text(a).toLocaleLowerCase("de-CH").includes(q);
  });

  visibleCount = PAGE_SIZE;
  render();
}

function render() {
  resultCount.textContent = `${filteredAffairs.length.toLocaleString("de-CH")} Geschäfte`;

  const shown = filteredAffairs.slice(0, visibleCount);

  if (!shown.length) {
    results.innerHTML = `<div class="empty">Keine Geschäfte für diese Auswahl gefunden.</div>`;
    moreButton.hidden = true;
    return;
  }

  results.innerHTML = shown.map(a => {
    const id = String(a?.id ?? getNumber(a));
    const type = escapeHtml(getType(a));
    const number = escapeHtml(getNumber(a));
    const title = escapeHtml(stripHtml(getTitle(a)));
    const state = escapeHtml(text(getState(a)));
    const council = escapeHtml(text(getCouncil(a)));
    const author = escapeHtml(text(getAuthor(a)));
    const submittedHtml = getSubmittedText(a);
    const preview = escapeHtml(getPreview(submittedHtml));
    const isOpen = openAffairs.has(id);
    const detailBits = [author, council, state].filter(Boolean);

    let body = "";

    if (submittedHtml) {
      body = `
        <div class="affair-reader">
          <div class="preview-text" ${isOpen ? "hidden" : ""}>${preview}</div>

          <div class="full-text" ${isOpen ? "" : "hidden"}>
            ${submittedHtml}
          </div>

          <button
            class="toggle-text"
            type="button"
            data-affair-id="${escapeHtml(id)}"
            aria-expanded="${isOpen ? "true" : "false"}"
          >
            ${isOpen ? "Text zuklappen ↑" : "Ganzen Text anzeigen ↓"}
          </button>
        </div>
      `;
    } else {
      body = `<div class="no-text">Noch kein eingereichter Text verfügbar.</div>`;
    }

    return `
      <article class="card ${isOpen ? "is-open" : ""}" data-card-id="${escapeHtml(id)}">
        <div class="meta">
          <span class="badge">${type}</span>
          <span class="number">${number}</span>
        </div>

        <h2>
          <a href="${parliamentUrl(a)}" target="_blank" rel="noopener">${title}</a>
        </h2>

        ${detailBits.length ? `<div class="details">${detailBits.join(" · ")}</div>` : ""}

        ${body}
      </article>
    `;
  }).join("");

  moreButton.hidden = visibleCount >= filteredAffairs.length;
}

function toggleAffair(id) {
  const card = results.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
  if (!card) return;

  const preview = card.querySelector(".preview-text");
  const full = card.querySelector(".full-text");
  const button = card.querySelector(".toggle-text");
  if (!preview || !full || !button) return;

  const opening = !openAffairs.has(id);

  if (opening) {
    openAffairs.add(id);
    preview.hidden = true;
    full.hidden = false;
    card.classList.add("is-open");
    button.textContent = "Text zuklappen ↑";
    button.setAttribute("aria-expanded", "true");
  } else {
    openAffairs.delete(id);
    preview.hidden = false;
    full.hidden = true;
    card.classList.remove("is-open");
    button.textContent = "Ganzen Text anzeigen ↓";
    button.setAttribute("aria-expanded", "false");

    // Beim Zuklappen springt die Seite sanft zum Anfang des Geschäfts zurück.
    const top = card.getBoundingClientRect().top;
    if (top < 0) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

results.addEventListener("click", event => {
  const button = event.target.closest(".toggle-text");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  toggleAffair(button.dataset.affairId);
});

async function init() {
  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    allAffairs = await response.json();
    if (!Array.isArray(allAffairs)) throw new Error("JSON ist keine Liste.");

    populateTypes();
    filteredAffairs = allAffairs;

    const newestFetch = allAffairs
      .map(a => a?._site?.fetched_at)
      .filter(Boolean)
      .sort()
      .at(-1);

    if (newestFetch) {
      const d = new Date(newestFetch);
      updated.textContent = `Datenabruf: ${d.toLocaleString("de-CH")}`;
    }

    render();
  } catch (error) {
    console.error(error);
    resultCount.textContent = "Daten konnten nicht geladen werden";
    results.innerHTML = `<div class="empty">Fehler beim Laden von ${escapeHtml(DATA_URL)}.</div>`;
  }
}

typeFilter.addEventListener("change", applyFilters);
searchInput.addEventListener("input", applyFilters);

resetButton.addEventListener("click", () => {
  typeFilter.value = "";
  searchInput.value = "";
  applyFilters();
});

moreButton.addEventListener("click", () => {
  visibleCount += PAGE_SIZE;
  render();
});

init();
