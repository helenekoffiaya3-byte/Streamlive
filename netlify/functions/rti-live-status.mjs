const RTI_PLAY_BASE = "https://www.rtiplay.ci";
const CHANNELS = {
  "rti-1": { name: "RTI1", path: "/rti1/direct" },
  "rti-2": { name: "RTI2", path: "/rti2/direct" },
  "la-3": { name: "La 3", path: "/la3/direct" }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      ...extraHeaders
    }
  });
}

function normalize(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function fetchPage(url, signal) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Streamlive/1.0"
    },
    signal
  });
  return { response, html: await response.text() };
}

function detectActiveChannel(html) {
  const text = normalize(html);
  const match = text.match(/vous\s+suivez\s+actuellement\s+(.{1,100}?)\s+en\s+direct/i);
  const current = normalize(match ? match[1] : "");

  for (const [id, channel] of Object.entries(CHANNELS)) {
    if (current === normalize(channel.name) || current.includes(normalize(channel.name))) {
      return id;
    }
  }

  return null;
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const checks = await Promise.all(
      Object.entries(CHANNELS).map(async ([id, channel]) => {
        const url = RTI_PLAY_BASE + channel.path;
        try {
          const { response, html } = await fetchPage(url, controller.signal);
          return {
            id,
            name: channel.name,
            url,
            ok: response.ok,
            activeChannel: detectActiveChannel(html)
          };
        } catch (error) {
          return {
            id,
            name: channel.name,
            url,
            ok: false,
            activeChannel: null,
            error: error.name === "AbortError" ? "TIMEOUT" : "FETCH_ERROR"
          };
        }
      })
    );

    // RTI Play exposes the currently selected live TV channel on its direct pages.
    // Prefer an explicit "Vous suivez actuellement X en direct" signal.
    const active = checks.find((item) => item.ok && item.activeChannel);

    if (!active) {
      return json({
        available: false,
        activeChannel: null,
        activeName: null,
        liveUrl: null,
        checkedAt: new Date().toISOString(),
        source: RTI_PLAY_BASE,
        checks
      });
    }

    const activeChannel = active.activeChannel;
    const activeInfo = CHANNELS[activeChannel];

    return json({
      available: true,
      activeChannel,
      activeName: activeInfo.name,
      liveUrl: RTI_PLAY_BASE + activeInfo.path,
      checkedAt: new Date().toISOString(),
      source: RTI_PLAY_BASE,
      checks
    });
  } catch (error) {
    return json({
      available: false,
      activeChannel: null,
      activeName: null,
      liveUrl: null,
      error: error.name === "AbortError" ? "RTI_PLAY_TIMEOUT" : "RTI_PLAY_FETCH_ERROR"
    }, 502);
  } finally {
    clearTimeout(timer);
  }
}

export const config = { path: "/api/rti-live-status" };
