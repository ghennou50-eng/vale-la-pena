require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const https = require("https");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ==================================================
// JSON DATABASE (works everywhere, no native deps)
// ==================================================
const DB_FILE = path.join(__dirname, "database.json");

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
        }
    } catch (e) {
        console.log("Error loading DB:", e.message);
    }
    return { users: [], analyses: [], nextUserId: 1, nextAnalysisId: 1 };
}

function saveDB(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
    } catch (e) {
        console.log("Error saving DB:", e.message);
    }
}

let db = loadDB();

// Ensure tables exist
if (!db.users) db.users = [];
if (!db.analyses) db.analyses = [];
if (!db.nextUserId) db.nextUserId = 1;
if (!db.nextAnalysisId) db.nextAnalysisId = 1;

// ==================================================
// MIDDLEWARE
// ==================================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
  secret: process.env.SESSION_SECRET || "vale-la-pena-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());

// ==================================================
// PASSPORT GOOGLE OAUTH
// ==================================================
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback"
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails[0].value;
        const googleId = profile.id;
        const name = profile.displayName;
        const avatar = profile.photos[0]?.value;

        let user = db.users.find(u => u.google_id === googleId);

        if (!user) {
          const existing = db.users.find(u => u.email === email);
          if (existing) {
            existing.google_id = googleId;
            existing.avatar = avatar || existing.avatar;
            user = existing;
          } else {
            user = {
              id: db.nextUserId++,
              email: email,
              name: name,
              password: null,
              google_id: googleId,
              avatar: avatar,
              created_at: new Date().toISOString()
            };
            db.users.push(user);
          }
          saveDB(db);
        }
        return done(null, user);
      }
    ));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.users.find(u => u.id === id);
  done(null, user || null);
});

// ==================================================
// JWT MIDDLEWARE
// ==================================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET || "jwt-secret-vale-la-pena", (err, user) => {
    if (err) {
      req.user = null;
    } else {
      req.user = user;
    }
    next();
  });
}

// ==================================================
// AUTH ROUTES
// ==================================================

// Register
app.post("/api/register", async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: "Email y contraseña obligatorios" });
  }

  const existing = db.users.find(u => u.email === email);
  if (existing) {
    return res.status(400).json({ success: false, error: "El email ya está registrado" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = {
    id: db.nextUserId++,
    email: email,
    name: name || email.split("@")[0],
    password: hashed,
    google_id: null,
    avatar: null,
    created_at: new Date().toISOString()
  };

  db.users.push(user);
  saveDB(db);

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET || "jwt-secret-vale-la-pena",
    { expiresIn: "7d" }
  );

  res.json({
    success: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
  });
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = db.users.find(u => u.email === email);
  if (!user || !user.password) {
    return res.status(400).json({ success: false, error: "Credenciales incorrectas" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(400).json({ success: false, error: "Credenciales incorrectas" });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET || "jwt-secret-vale-la-pena",
    { expiresIn: "7d" }
  );

  res.json({
    success: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
  });
});

// Google OAuth
app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login.html" }),
  (req, res) => {
    const token = jwt.sign(
      { id: req.user.id, email: req.user.email, name: req.user.name },
      process.env.JWT_SECRET || "jwt-secret-vale-la-pena",
      { expiresIn: "7d" }
    );
    res.redirect(`/login.html?token=${token}`);
  }
);

// Get current user
app.get("/api/me", authenticateToken, (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, error: "No autenticado" });
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  res.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
  });
});

// Logout
app.post("/api/logout", (req, res) => {
  req.logout(() => {
    res.json({ success: true });
  });
});

// ==================================================
// ANALYSIS HISTORY ROUTES
// ==================================================

// Save analysis
app.post("/api/analyses", authenticateToken, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "No autenticado" });
  }
  const { product_name, result } = req.body;
  if (!product_name || !result) {
    return res.status(400).json({ success: false, error: "Datos incompletos" });
  }

  const analysis = {
    id: db.nextAnalysisId++,
    user_id: req.user.id,
    product_name: product_name,
    result: result,
    created_at: new Date().toISOString()
  };

  db.analyses.push(analysis);
  saveDB(db);

  res.json({ success: true });
});

// Get user's analyses
app.get("/api/analyses", authenticateToken, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "No autenticado" });
  }

  const userAnalyses = db.analyses
    .filter(a => a.user_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 20);

  res.json({ success: true, analyses: userAnalyses });
});

// Delete analysis
app.delete("/api/analyses/:id", authenticateToken, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "No autenticado" });
  }

  const idx = db.analyses.findIndex(a => a.id === parseInt(req.params.id) && a.user_id === req.user.id);
  if (idx !== -1) {
    db.analyses.splice(idx, 1);
    saveDB(db);
  }

  res.json({ success: true });
});

// ==================================================
// EXISTING ANALYZE FUNCTIONALITY (PRESERVED)
// ==================================================

function requestHTTPS(options, data) {
  return new Promise((resolve, reject) => {
    const request = https.request(options, response => {
      let result = "";
      response.on("data", chunk => { result += chunk; });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode, body: result });
      });
    });
    request.on("error", error => { reject(error); });
    if (data) request.write(data);
    request.end();
  });
}

async function tavilySearch(query, maxResults) {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY no está configurada");
  }

  const data = JSON.stringify({
    query: query,
    search_depth: "advanced",
    topic: "general",
    max_results: maxResults || 6,
    include_answer: true,
    include_raw_content: false
  });

  const options = {
    hostname: "api.tavily.com",
    path: "/search",
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.TAVILY_API_KEY,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data)
    }
  };

  const { statusCode, body } = await requestHTTPS(options, data);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("Tavily HTTP " + statusCode + ": " + body);
  }

  return JSON.parse(body);
}

function guessBrandToken(product) {
  const firstWord = (product || "").trim().split(/\s+/)[0] || "";
  const token = firstWord
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return token.length >= 3 ? token : null;
}

function flagOfficialSources(product, results) {
  const brandToken = guessBrandToken(product);
  return results.map(item => {
    let hostname = "";
    try {
      hostname = new URL(item.url).hostname.toLowerCase().replace(/^www\./, "");
    } catch (error) { hostname = ""; }

    const isOfficial = !!brandToken && !!hostname && hostname.includes(brandToken);
    return { ...item, _hostname: hostname, _official: isOfficial };
  });
}

async function searchProduct(product) {
  const generalQuery = `${product} análisis características especificaciones opiniones España 2026`;
  const priceQuery = `${product} precio oficial España 2026 comprar tienda`;

  const [generalData, priceData] = await Promise.all([
    tavilySearch(generalQuery, 6),
    tavilySearch(priceQuery, 5)
  ]);

  const seenUrls = new Set();
  const merged = [];

  (generalData.results || []).forEach(item => {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      merged.push({ ...item, _stage: "general" });
    }
  });

  (priceData.results || []).forEach(item => {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      merged.push({ ...item, _stage: "precio" });
    }
  });

  const capped = merged.slice(0, 10);
  const flagged = flagOfficialSources(product, capped);

  return {
    answer: generalData.answer || null,
    priceAnswer: priceData.answer || null,
    results: flagged
  };
}

function prepareWebInformation(webData) {
  if (!webData) return "";

  let information = "";

  if (webData.answer) {
    information += `\nRESUMEN GENERAL (búsqueda de características):\n\n${webData.answer}\n`;
  }

  if (webData.priceAnswer) {
    information += `\nRESUMEN DE PRECIO (búsqueda específica de precio):\n\n${webData.priceAnswer}\n`;
  }

  if (Array.isArray(webData.results)) {
    webData.results.forEach((item, index) => {
      const officialTag = item._official ? "  [POSIBLE FUENTE OFICIAL DEL FABRICANTE]" : "";
      const stageTag = item._stage === "precio" ? " (hallada en la búsqueda de precio)" : " (hallada en la búsqueda general)";
      information += `\nFUENTE ${index + 1}${officialTag}${stageTag}\n\nTÍTULO:\n${item.title || ""}\n\nURL:\n${item.url || ""}\n\nCONTENIDO:\n${item.content || ""}\n`;
    });
  }

  return information;
}

async function callAI(product, webData) {
  const webInformation = prepareWebInformation(webData);

  const prompt = `Eres el motor de análisis de una aplicación española llamada: "¿Vale la pena?"

Tu trabajo es analizar productos pensando específicamente en consumidores de España.

==================================================
PRODUCTO
==================================================

${product}

==================================================
INFORMACIÓN ACTUAL DE INTERNET
==================================================

Las fuentes marcadas con [POSIBLE FUENTE OFICIAL DEL FABRICANTE] provienen de un dominio que coincide con la marca del producto y deben tener prioridad para el precio, si contienen un precio.

${webInformation}

==================================================
REGLAS IMPORTANTES
==================================================

Utiliza las fuentes anteriores para analizar el producto.
NO inventes información.
NO inventes precios.
NO inventes especificaciones.
NO inventes URLs que no aparezcan exactamente en las fuentes.
Si un dato no puede confirmarse razonablemente, utiliza null.
No confundas modelos diferentes.
No utilices información de otro producto parecido.
No des siempre la misma puntuación.
La puntuación debe depender de la situación real del producto en España.

==================================================
PUNTUACIÓN
==================================================

Utiliza exactamente estos cinco criterios:

precio_valor: 0 a 2
calidad_especificaciones: 0 a 2
rendimiento_utilidad: 0 a 2
competencia: 0 a 2
mercado_espanol: 0 a 2

Puedes utilizar decimales de 0.1.
La puntuación final debe ser exactamente la suma de los cinco criterios.

==================================================
PRECIO — REGLAS DETALLADAS (MUY IMPORTANTE)
==================================================

Prioridad para elegir el precio:
NIVEL 1 — Fuente oficial del fabricante (marcada como [POSIBLE FUENTE OFICIAL DEL FABRICANTE]).
NIVEL 2 — Fuentes especializadas o de confianza en español.
NIVEL 3 — Si ninguna fuente da un precio claro y fiable, "precio_espana" debe ser null.

Ignora por completo números que sean: cuotas, financiación, descuentos aislados, accesorios, suscripciones, alquiler, versiones anteriores.

FORMATO NUMÉRICO ESPAÑOL:
"39.990 €" significa 39990 euros (NO 39,99).
"1.234,56 €" significa 1234,56 euros.

RANGOS DE PRECIO:
Si las fuentes indican un rango, usa "min" y "max".
Si solo hay un precio único, usa el mismo valor en "min" y "max".

FUENTE DEL PRECIO:
Indica "fuente.nombre" y "fuente.url" exacta de la fuente.

==================================================
ESPECIFICACIONES
==================================================
Incluye entre 4 y 8 especificaciones importantes.

==================================================
VENTAJAS
==================================================
Exactamente 3.

==================================================
DESVENTAJAS
==================================================
Exactamente 3.

==================================================
VEREDICTO
==================================================
Corto. Ejemplos: "Merece la pena.", "No merece la pena para la mayoría."

==================================================
RESUMEN
==================================================
Corto, claro, explica por qué merece o no la pena.

==================================================
FORMATO
==================================================
RESPONDE EXCLUSIVAMENTE CON JSON VÁLIDO. NO Markdown. NO texto fuera del JSON.

{
  "producto": "",
  "tipo": "",
  "puntuacion": 0,
  "criterios": {
    "precio_valor": 0,
    "calidad_especificaciones": 0,
    "rendimiento_utilidad": 0,
    "competencia": 0,
    "mercado_espanol": 0
  },
  "precio_espana": {
    "min": 0,
    "max": 0,
    "confirmado": true,
    "fuente": { "nombre": "", "url": "" }
  },
  "moneda": "EUR",
  "especificaciones": [{ "nombre": "", "valor": "" }],
  "ventajas": ["", "", ""],
  "desventajas": ["", "", ""],
  "para_quien": "",
  "no_para_quien": "",
  "veredicto": "",
  "resumen": ""
}

Si no se puede determinar el precio, "precio_espana" debe ser exactamente null.`;

  const data = JSON.stringify({
    model: "meta-llama/Llama-3.1-8B-Instruct:novita",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1800,
    temperature: 0.15
  });

  const options = {
    hostname: "router.huggingface.co",
    path: "/v1/chat/completions",
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.HF_TOKEN,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data)
    }
  };

  const { statusCode, body } = await requestHTTPS(options, data);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("Hugging Face HTTP " + statusCode + ": " + body);
  }

  const json = JSON.parse(body);

  if (!json.choices || !json.choices[0] || !json.choices[0].message) {
    throw new Error("Respuesta de IA inesperada");
  }

  return json.choices[0].message.content;
}

function parseAIResponse(answer) {
  if (!answer) throw new Error("La IA no devolvió contenido");

  let clean = answer.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(clean);
}

function validatePrice(analysis, knownResults) {
  const raw = analysis.precio_espana;

  if (!raw || typeof raw !== "object") {
    analysis.precio_espana = null;
    return analysis;
  }

  let min = Number(raw.min);
  let max = raw.max !== undefined && raw.max !== null ? Number(raw.max) : min;
  const MAX_REASONABLE_PRICE = 10000000;

  if (isNaN(min) || min <= 0 || min > MAX_REASONABLE_PRICE) {
    analysis.precio_espana = null;
    return analysis;
  }

  if (isNaN(max) || max <= 0 || max > MAX_REASONABLE_PRICE) max = min;
  if (max < min) { const temp = min; min = max; max = temp; }

  min = Math.round(min * 100) / 100;
  max = Math.round(max * 100) / 100;
  const confirmado = !!raw.confirmado;

  let fuente = null;
  const rawFuente = raw.fuente;

  if (rawFuente) {
    let nombre = null;
    let url = null;

    if (typeof rawFuente === "string") {
      nombre = rawFuente.trim() || null;
    } else if (typeof rawFuente === "object") {
      nombre = (rawFuente.nombre || rawFuente.name || "").trim() || null;
      url = (rawFuente.url || "").trim() || null;
    }

    if (url) {
      const urlExists = Array.isArray(knownResults) && knownResults.some(item => item.url === url);
      if (!urlExists) url = null;
    }

    if (nombre || url) fuente = { nombre: nombre, url: url };
  }

  analysis.precio_espana = { min: min, max: max, confirmado: confirmado, fuente: fuente };
  return analysis;
}

function validateAnalysis(analysis, knownResults) {
  if (!analysis) throw new Error("Análisis vacío");

  if (!analysis.criterios) analysis.criterios = {};

  const names = ["precio_valor", "calidad_especificaciones", "rendimiento_utilidad", "competencia", "mercado_espanol"];
  let total = 0;

  names.forEach(name => {
    let value = Number(analysis.criterios[name]);
    if (isNaN(value)) value = 0;
    if (value < 0) value = 0;
    if (value > 2) value = 2;
    value = Math.round(value * 10) / 10;
    analysis.criterios[name] = value;
    total += value;
  });

  analysis.puntuacion = Math.round(total * 10) / 10;

  if (!Array.isArray(analysis.ventajas)) analysis.ventajas = [];
  while (analysis.ventajas.length < 3) analysis.ventajas.push("Información no disponible");
  analysis.ventajas = analysis.ventajas.slice(0, 3);

  if (!Array.isArray(analysis.desventajas)) analysis.desventajas = [];
  while (analysis.desventajas.length < 3) analysis.desventajas.push("Información no disponible");
  analysis.desventajas = analysis.desventajas.slice(0, 3);

  if (!Array.isArray(analysis.especificaciones)) analysis.especificaciones = [];
  analysis.especificaciones = analysis.especificaciones.slice(0, 8);

  analysis = validatePrice(analysis, knownResults);
  return analysis;
}

// ==================================================
// ANALYZE ENDPOINT (PRESERVED + AUTH OPTIONAL)
// ==================================================
app.post("/analyze", authenticateToken, async (req, res) => {
  const product = req.body.product;

  if (!product) {
    return res.status(400).json({ success: false, message: "Producto no especificado" });
  }

  console.log("\n================================");
  console.log("Analizando:", product);
  console.log("Buscando información...");

  let webData;
  try {
    webData = await searchProduct(product);
  } catch (searchError) {
    console.log("ERROR TAVILY:", searchError.message);
    return res.status(500).json({
      success: false,
      message: "Error al buscar información",
      error: searchError.message
    });
  }

  console.log("Fuentes encontradas:", webData.results ? webData.results.length : 0);
  console.log("Analizando con IA...");

  let answer;
  try {
    answer = await callAI(product, webData);
  } catch (aiError) {
    console.log("ERROR IA:", aiError.message);
    return res.status(500).json({ success: false, message: aiError.message });
  }

  let analysis;
  try {
    analysis = parseAIResponse(answer);
    analysis = validateAnalysis(analysis, webData.results || []);
  } catch (jsonError) {
    console.log("ERROR JSON IA:", jsonError.message);
    return res.status(500).json({
      success: false,
      message: "La IA no devolvió un JSON válido",
      error: jsonError.message,
      raw: answer
    });
  }

  const sources = (webData && Array.isArray(webData.results))
    ? webData.results.slice(0, 8).map(item => ({
        title: item.title || "Fuente",
        url: item.url || ""
      })).filter(item => item.url)
    : [];

  // Save analysis if user is logged in
  if (req.user) {
    try {
      const newAnalysis = {
        id: db.nextAnalysisId++,
        user_id: req.user.id,
        product_name: product,
        result: analysis,
        created_at: new Date().toISOString()
      };
      db.analyses.push(newAnalysis);
      saveDB(db);
    } catch (e) {
      console.log("Error guardando análisis:", e.message);
    }
  }

  res.json({ success: true, analysis: analysis, sources: sources });

  console.log("Análisis completado.");
  console.log("Puntuación:", analysis.puntuacion);
  console.log("================================\n");
});

// ==================================================
// HOME
// ==================================================
app.get("/api", (req, res) => {
  res.json({ success: true, message: "Servidor funcionando" });
});

// ==================================================
// START
// ==================================================
app.listen(PORT, () => {
  console.log("Servidor iniciado en el puerto " + PORT);
});