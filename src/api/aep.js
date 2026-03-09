const AEP_SCRAPE_URL = "https://aep-q.aep.com/recreation/hydro/";
const AEP_REFERENCE_URL = "https://www.aep.com/recreation/hydro/whitethornelaunch/";

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stripTags(input) {
  return input.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function parseProjectRow(html, projectName) {
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const row = match[1];
    if (!new RegExp(`>${projectName}<`, "i").test(row)) {
      continue;
    }

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    if (cells.length < 5) {
      return null;
    }

    return {
      project: cells[0],
      gageHeightFt: asNumber(cells[3]),
      flowCfs: asNumber(cells[4]),
    };
  }

  return null;
}

export async function getAepCurrent(projectName = "Claytor") {
  const response = await fetch(AEP_SCRAPE_URL);
  if (!response.ok) {
    throw new Error("AEP hydro page request failed.");
  }

  const html = await response.text();
  const newRiverStart = html.indexOf("New River Flows &amp; Forecasts");
  if (newRiverStart < 0) {
    throw new Error("Could not find New River section on AEP page.");
  }

  const section = html.slice(newRiverStart, newRiverStart + 20000);
  const project = parseProjectRow(section, projectName);
  if (!project) {
    throw new Error(`Could not find ${projectName} row in AEP table.`);
  }

  const updatedMatch = section.match(/Data last updated on <span>(.*?)<\/span>/i);

  return {
    sourceUrl: AEP_REFERENCE_URL,
    project: project.project,
    flowCfs: project.flowCfs,
    gageHeightFt: project.gageHeightFt,
    updated: updatedMatch ? stripTags(updatedMatch[1]) : null,
  };
}
