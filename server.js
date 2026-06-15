const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function extractEventId(input) {
  if (!input) return null;

  const decoded = decodeURIComponent(input);

  // Sofascore costuma usar #id:12345678 no link do evento
  let m = decoded.match(/[#?&]id[:=](\d+)/i);
  if (m) return m[1];

  // Aceita colar apenas o número do evento
  m = decoded.match(/^\s*(\d{5,})\s*$/);
  if (m) return m[1];

  // Plano B: último número grande encontrado no link
  const nums = decoded.match(/\d{5,}/g);
  if (nums && nums.length) return nums[nums.length - 1];

  return null;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return 0;
}

function normalizeBasketballEvent(event) {
  const home = event.homeTeam?.name || event.homeTeam?.shortName || "Casa";
  const away = event.awayTeam?.name || event.awayTeam?.shortName || "Fora";
  const hs = event.homeScore || {};
  const as = event.awayScore || {};

  // Nomes possíveis que aparecem em placares por período.
  // Mantive várias opções para aguentar mudanças pequenas no formato da resposta.
  const homeQ1 = pick(hs, ["period1", "quarter1", "q1", "firstQuarter"]);
  const homeQ2 = pick(hs, ["period2", "quarter2", "q2", "secondQuarter"]);
  const homeQ3 = pick(hs, ["period3", "quarter3", "q3", "thirdQuarter"]);
  const homeQ4 = pick(hs, ["period4", "quarter4", "q4", "fourthQuarter"]);

  const awayQ1 = pick(as, ["period1", "quarter1", "q1", "firstQuarter"]);
  const awayQ2 = pick(as, ["period2", "quarter2", "q2", "secondQuarter"]);
  const awayQ3 = pick(as, ["period3", "quarter3", "q3", "thirdQuarter"]);
  const awayQ4 = pick(as, ["period4", "quarter4", "q4", "fourthQuarter"]);

  const homeTotal = pick(hs, ["current", "display", "normaltime"]) || (homeQ1 + homeQ2 + homeQ3 + homeQ4);
  const awayTotal = pick(as, ["current", "display", "normaltime"]) || (awayQ1 + awayQ2 + awayQ3 + awayQ4);

  return {
    source: "sofascore",
    eventId: event.id,
    status: event.status?.description || event.status?.type || "",
    home,
    away,
    quarters: {
      home: [homeQ1, homeQ2, homeQ3, homeQ4],
      away: [awayQ1, awayQ2, awayQ3, awayQ4]
    },
    totals: {
      home: homeTotal,
      away: awayTotal
    }
  };
}

app.get("/api/sofascore", async (req, res) => {
  try {
    const eventId = extractEventId(req.query.url || req.query.id);
    if (!eventId) {
      return res.status(400).json({
        error: "Não encontrei o ID do evento. Cole o link do Sofascore com #id:123456 ou cole apenas o número do ID."
      });
    }

    const urls = [
      `https://www.sofascore.com/api/v1/event/${eventId}`,
      `https://api.sofascore.com/api/v1/event/${eventId}`
    ];

    let data = null;
    let lastError = null;

    for (const url of urls) {
      try {
        const r = await fetch(url, {
          headers: {
            "accept": "application/json,text/plain,*/*",
            "user-agent": "Mozilla/5.0 OverBasqueteLocal/1.0"
          }
        });

        if (!r.ok) {
          lastError = `HTTP ${r.status} em ${url}`;
          continue;
        }

        data = await r.json();
        break;
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!data || !data.event) {
      return res.status(502).json({
        error: "Não consegui ler o evento no Sofascore.",
        details: lastError || "Resposta sem campo event."
      });
    }

    return res.json(normalizeBasketballEvent(data.event));
  } catch (err) {
    return res.status(500).json({ error: "Erro interno no servidor.", details: err.message });
  }
});

app.get("/api/demo", (req, res) => {
  res.json({
    source: "demo",
    eventId: "demo",
    status: "Exemplo da imagem",
    home: "Instituto",
    away: "La Unión Formosa",
    quarters: {
      home: [22, 22, 29, 14],
      away: [21, 17, 13, 12]
    },
    totals: {
      home: 87,
      away: 63
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});