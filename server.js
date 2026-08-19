require("dotenv").config();

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");


// ==================================================
// SERVIR ARCHIVOS DEL FRONTEND (index.html, style.css, script.js)
// ==================================================
// Permite que el mismo servidor sirva la interfaz, para
// que todo funcione bajo una sola URL al desplegar.
// ==================================================

const STATIC_FILES = {

    "/": {
        file: "index.html",
        type: "text/html; charset=utf-8"
    },

    "/index.html": {
        file: "index.html",
        type: "text/html; charset=utf-8"
    },

    "/style.css": {
        file: "style.css",
        type: "text/css; charset=utf-8"
    },

    "/script.js": {
        file: "script.js",
        type: "application/javascript; charset=utf-8"
    }

};


function serveStaticFile(req, res) {

    const entry = STATIC_FILES[req.url];

    if (!entry) {
        return false;
    }


    const filePath =
        path.join(__dirname, entry.file);


    fs.readFile(filePath, (error, content) => {

        if (error) {

            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            res.end("Archivo no encontrado");

            return;
        }


        res.writeHead(200, {
            "Content-Type": entry.type
        });

        res.end(content);

    });


    return true;
}


// ==================================================
// UTILIDAD: PETICIÓN HTTPS (Promise)
// ==================================================

function requestHTTPS(options, data) {

    return new Promise((resolve, reject) => {

        const request = https.request(
            options,
            response => {

                let result = "";

                response.on("data", chunk => {
                    result += chunk;
                });

                response.on("end", () => {

                    resolve({
                        statusCode: response.statusCode,
                        body: result
                    });

                });
            }
        );

        request.on("error", error => {
            reject(error);
        });

        if (data) {
            request.write(data);
        }

        request.end();

    });

}



// ==================================================
// TAVILY — BÚSQUEDA INDIVIDUAL
// ==================================================

async function tavilySearch(query, maxResults) {

    if (!process.env.TAVILY_API_KEY) {

        throw new Error(
            "TAVILY_API_KEY no está configurada"
        );
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

            "Authorization":
                "Bearer " + process.env.TAVILY_API_KEY,

            "Content-Type":
                "application/json",

            "Content-Length":
                Buffer.byteLength(data)
        }
    };


    const { statusCode, body } =
        await requestHTTPS(options, data);


    if (statusCode < 200 || statusCode >= 300) {

        throw new Error(
            "Tavily HTTP " + statusCode + ": " + body
        );
    }


    return JSON.parse(body);
}



// ==================================================
// DETECCIÓN GENÉRICA DE FUENTES OFICIALES
// ==================================================
// Regla general y válida para cualquier producto:
// si el hostname de la fuente contiene la primera
// palabra del nombre del producto (normalmente la marca),
// se marca como "posible fuente oficial".
// No existe ninguna lista de marcas ni condición
// específica de un tipo de producto.
// ==================================================

function guessBrandToken(product) {

    const firstWord =
        (product || "")
            .trim()
            .split(/\s+/)[0] || "";

    const token =
        firstWord
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

            hostname =
                new URL(item.url).hostname
                    .toLowerCase()
                    .replace(/^www\./, "");

        } catch (error) {

            hostname = "";
        }

        const isOfficial =
            !!brandToken &&
            !!hostname &&
            hostname.includes(brandToken);

        return {
            ...item,
            _hostname: hostname,
            _official: isOfficial
        };

    });
}



// ==================================================
// BÚSQUEDA EN DOS ETAPAS: GENERAL + PRECIO
// ==================================================

async function searchProduct(product) {

    const generalQuery =
        `${product} análisis características especificaciones opiniones España 2026`;

    const priceQuery =
        `${product} precio oficial España 2026 comprar tienda`;


    const [generalData, priceData] =
        await Promise.all([

            tavilySearch(generalQuery, 6),

            tavilySearch(priceQuery, 5)

        ]);


    const seenUrls = new Set();

    const merged = [];


    (generalData.results || []).forEach(item => {

        if (item.url && !seenUrls.has(item.url)) {

            seenUrls.add(item.url);

            merged.push({
                ...item,
                _stage: "general"
            });
        }

    });


    (priceData.results || []).forEach(item => {

        if (item.url && !seenUrls.has(item.url)) {

            seenUrls.add(item.url);

            merged.push({
                ...item,
                _stage: "precio"
            });
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



// ==================================================
// PREPARAR INFORMACIÓN DE INTERNET PARA LA IA
// ==================================================

function prepareWebInformation(webData) {

    if (!webData) {
        return "";
    }


    let information = "";


    if (webData.answer) {

        information += `

RESUMEN GENERAL (búsqueda de características):

${webData.answer}

`;
    }


    if (webData.priceAnswer) {

        information += `

RESUMEN DE PRECIO (búsqueda específica de precio):

${webData.priceAnswer}

`;
    }


    if (Array.isArray(webData.results)) {

        webData.results.forEach((item, index) => {

            const officialTag =
                item._official
                    ? "  [POSIBLE FUENTE OFICIAL DEL FABRICANTE]"
                    : "";

            const stageTag =
                item._stage === "precio"
                    ? " (hallada en la búsqueda de precio)"
                    : " (hallada en la búsqueda general)";

            information += `

FUENTE ${index + 1}${officialTag}${stageTag}

TÍTULO:
${item.title || ""}

URL:
${item.url || ""}

CONTENIDO:
${item.content || ""}

`;

        });

    }


    return information;
}



// ==================================================
// HUGGING FACE
// ==================================================

async function callAI(product, webData) {

    const webInformation =
        prepareWebInformation(webData);


    const prompt = `

Eres el motor de análisis de una aplicación española llamada:

"¿Vale la pena?"

Tu trabajo es analizar productos pensando específicamente
en consumidores de España.


==================================================
PRODUCTO
==================================================

${product}


==================================================
INFORMACIÓN ACTUAL DE INTERNET
==================================================

Las fuentes marcadas con [POSIBLE FUENTE OFICIAL DEL FABRICANTE]
provienen de un dominio que coincide con la marca del producto
y deben tener prioridad para el precio, si contienen un precio.

${webInformation}


==================================================
REGLAS IMPORTANTES
==================================================

Utiliza las fuentes anteriores para analizar el producto.

NO inventes información.

NO inventes precios.

NO inventes especificaciones.

NO inventes URLs que no aparezcan exactamente en las fuentes.

Si un dato no puede confirmarse razonablemente,
utiliza null.

No confundas modelos diferentes.

No utilices información de otro producto parecido.

No des siempre la misma puntuación.

La puntuación debe depender de la situación real
del producto en España.


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

La puntuación final debe ser exactamente
la suma de los cinco criterios.

Ejemplo:

1.5 + 1.8 + 1.7 + 1.4 + 1.6 = 8.0


==================================================
PRECIO — REGLAS DETALLADAS (MUY IMPORTANTE)
==================================================

Prioridad para elegir el precio:

NIVEL 1 — Fuente oficial del fabricante
(marcada como [POSIBLE FUENTE OFICIAL DEL FABRICANTE]).
Si aquí hay un precio claro, úsalo y marca "confirmado": true.

NIVEL 2 — Fuentes especializadas o de confianza en español
(tiendas, medios de tecnología/motor, comparadores).
Si no hay fuente oficial pero una fuente especializada da
un precio claro, úsalo y marca "confirmado": false.

NIVEL 3 — Si ninguna fuente da un precio claro y fiable,
"precio_espana" debe ser null. No adivines ni promedies.

Ignora por completo números que sean:

- cuotas o pagos mensuales ("X €/mes")
- financiación o entrada inicial
- descuentos o ahorro aislado ("ahorra X €")
- accesorios, piezas o repuestos
- suscripciones o tarifas de servicio
- precio de alquiler
- precio de una versión anterior o distinta a la analizada
- precio de un producto diferente aunque sea similar

FORMATO NUMÉRICO ESPAÑOL (muy importante):

En los textos en español, el punto se usa como separador
de miles y la coma como separador decimal.

Ejemplos:

"39.990 €" significa 39990 euros (NO 39,99).

"1.234,56 €" significa 1234,56 euros.

Si un número aparece con formato ambiguo o inconsistente
entre fuentes, y no puedes estar razonablemente seguro de
su valor real, no lo uses.

RANGOS DE PRECIO:

Si las fuentes indican un rango (por ejemplo
"desde 39.990 € hasta 41.990 €" o "39.990 € - 41.990 €"),
usa ese rango completo en "min" y "max".

Si solo hay un precio único confirmado, usa el mismo
valor en "min" y "max".

FUENTE DEL PRECIO:

Si defines un precio, indica en "fuente.nombre" el nombre
corto del sitio (ejemplo: "Tesla", "PcComponentes") y en
"fuente.url" la URL EXACTA de la fuente, copiada tal cual
aparece en la lista de fuentes anterior. Si no puedes copiar
la URL exacta, deja "fuente.url" como null pero mantén
"fuente.nombre" si es posible.

Si "precio_espana" es null, "fuente" también debe ser null.


==================================================
ESPECIFICACIONES
==================================================

Incluye entre 4 y 8 especificaciones importantes.

Solo incluye especificaciones que puedan
confirmarse mediante las fuentes.


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

Debe ser corto.

Ejemplos:

"Merece la pena."

"Merece la pena, pero depende del precio."

"No merece la pena para la mayoría."


==================================================
RESUMEN
==================================================

Debe ser corto, claro y explicar globalmente
por qué el producto merece o no merece la pena.


==================================================
FORMATO
==================================================

RESPONDE EXCLUSIVAMENTE CON JSON VÁLIDO.

NO escribas Markdown.

NO escribas texto fuera del JSON.

NO utilices bloques de código.


La estructura EXACTA es:

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
    "fuente": {
      "nombre": "",
      "url": ""
    }
  },

  "moneda": "EUR",

  "especificaciones": [
    {
      "nombre": "",
      "valor": ""
    }
  ],

  "ventajas": [
    "",
    "",
    ""
  ],

  "desventajas": [
    "",
    "",
    ""
  ],

  "para_quien": "",

  "no_para_quien": "",

  "veredicto": "",

  "resumen": ""
}

Si no se puede determinar el precio, "precio_espana" debe
ser exactamente null (no un objeto con valores vacíos).

`;


    const data = JSON.stringify({

        model: "meta-llama/Llama-3.1-8B-Instruct:novita",

        messages: [
            {
                role: "user",
                content: prompt
            }
        ],

        max_tokens: 1800,

        temperature: 0.15
    });


    const options = {

        hostname: "router.huggingface.co",

        path: "/v1/chat/completions",

        method: "POST",

        headers: {

            "Authorization":
                "Bearer " + process.env.HF_TOKEN,

            "Content-Type":
                "application/json",

            "Content-Length":
                Buffer.byteLength(data)
        }
    };


    const { statusCode, body } =
        await requestHTTPS(options, data);


    if (statusCode < 200 || statusCode >= 300) {

        throw new Error(
            "Hugging Face HTTP " + statusCode + ": " + body
        );
    }


    const json = JSON.parse(body);


    if (
        !json.choices ||
        !json.choices[0] ||
        !json.choices[0].message
    ) {

        throw new Error(
            "Respuesta de IA inesperada"
        );
    }


    return json.choices[0].message.content;
}



// ==================================================
// LIMPIAR RESPUESTA JSON
// ==================================================

function parseAIResponse(answer) {

    if (!answer) {

        throw new Error(
            "La IA no devolvió contenido"
        );
    }


    let clean =
        answer
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();


    const firstBrace = clean.indexOf("{");

    const lastBrace = clean.lastIndexOf("}");


    if (
        firstBrace !== -1 &&
        lastBrace !== -1 &&
        lastBrace > firstBrace
    ) {

        clean =
            clean.substring(firstBrace, lastBrace + 1);
    }


    return JSON.parse(clean);
}



// ==================================================
// VALIDAR PRECIO (GENÉRICO, SIN REGLAS POR PRODUCTO)
// ==================================================

function validatePrice(analysis, knownResults) {

    const raw = analysis.precio_espana;


    if (!raw || typeof raw !== "object") {

        analysis.precio_espana = null;

        return analysis;
    }


    let min = Number(raw.min);

    let max =
        raw.max !== undefined && raw.max !== null
            ? Number(raw.max)
            : min;


    const MAX_REASONABLE_PRICE = 10000000;


    if (
        isNaN(min) ||
        min <= 0 ||
        min > MAX_REASONABLE_PRICE
    ) {

        analysis.precio_espana = null;

        return analysis;
    }


    if (
        isNaN(max) ||
        max <= 0 ||
        max > MAX_REASONABLE_PRICE
    ) {

        max = min;
    }


    if (max < min) {

        const temp = min;

        min = max;

        max = temp;
    }


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

            nombre =
                (rawFuente.nombre || rawFuente.name || "")
                    .trim() || null;

            url =
                (rawFuente.url || "").trim() || null;
        }


        if (url) {

            const urlExists =
                Array.isArray(knownResults) &&
                knownResults.some(
                    item => item.url === url
                );

            if (!urlExists) {
                url = null;
            }
        }


        if (nombre || url) {

            fuente = {
                nombre: nombre,
                url: url
            };
        }
    }


    analysis.precio_espana = {
        min: min,
        max: max,
        confirmado: confirmado,
        fuente: fuente
    };


    return analysis;
}



// ==================================================
// VALIDAR Y CORREGIR RESULTADO
// ==================================================

function validateAnalysis(analysis, knownResults) {

    if (!analysis) {

        throw new Error(
            "Análisis vacío"
        );
    }


    if (!analysis.criterios) {

        analysis.criterios = {};
    }


    const names = [

        "precio_valor",

        "calidad_especificaciones",

        "rendimiento_utilidad",

        "competencia",

        "mercado_espanol"

    ];


    let total = 0;


    names.forEach(name => {

        let value = Number(analysis.criterios[name]);


        if (isNaN(value)) {

            value = 0;
        }


        if (value < 0) {
            value = 0;
        }


        if (value > 2) {
            value = 2;
        }


        value = Math.round(value * 10) / 10;


        analysis.criterios[name] = value;


        total += value;

    });


    analysis.puntuacion = Math.round(total * 10) / 10;



    // -----------------------------
    // Ventajas
    // -----------------------------

    if (!Array.isArray(analysis.ventajas)) {

        analysis.ventajas = [];
    }


    while (analysis.ventajas.length < 3) {

        analysis.ventajas.push(
            "Información no disponible"
        );
    }


    analysis.ventajas =
        analysis.ventajas.slice(0, 3);



    // -----------------------------
    // Desventajas
    // -----------------------------

    if (!Array.isArray(analysis.desventajas)) {

        analysis.desventajas = [];
    }


    while (analysis.desventajas.length < 3) {

        analysis.desventajas.push(
            "Información no disponible"
        );
    }


    analysis.desventajas =
        analysis.desventajas.slice(0, 3);



    // -----------------------------
    // Especificaciones
    // -----------------------------

    if (!Array.isArray(analysis.especificaciones)) {

        analysis.especificaciones = [];
    }


    analysis.especificaciones =
        analysis.especificaciones.slice(0, 8);



    // -----------------------------
    // Precio (nuevo formato: objeto con rango)
    // -----------------------------

    analysis =
        validatePrice(analysis, knownResults);


    return analysis;
}



// ==================================================
// SERVER
// ==================================================

const server = http.createServer(
    async (req, res) => {


        // ==============================
        // CORS
        // ==============================

        res.setHeader(
            "Access-Control-Allow-Origin",
            "*"
        );

        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS"
        );

        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type"
        );


        if (req.method === "OPTIONS") {

            res.writeHead(204);

            res.end();

            return;
        }



        // ==============================
        // ARCHIVOS ESTÁTICOS (FRONTEND)
        // ==============================

        if (
            req.method === "GET" &&
            serveStaticFile(req, res)
        ) {

            return;
        }



        // ==============================
        // ANALYZE
        // ==============================

        if (
            req.url === "/analyze" &&
            req.method === "POST"
        ) {

            let body = "";


            req.on("data", chunk => {
                body += chunk;
            });


            req.on("end", async () => {

                let product;


                try {

                    const data = JSON.parse(body);

                    product = data.product;


                    if (!product) {

                        res.writeHead(400, {
                            "Content-Type":
                                "application/json"
                        });

                        res.end(JSON.stringify({
                            success: false,
                            message:
                                "Producto no especificado"
                        }));

                        return;
                    }

                } catch (error) {

                    res.writeHead(400, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(JSON.stringify({
                        success: false,
                        message: "JSON inválido"
                    }));

                    return;
                }


                console.log(
                    "\n================================"
                );

                console.log("Analizando:", product);

                console.log("Buscando información...");


                let webData;


                try {

                    webData =
                        await searchProduct(product);

                } catch (searchError) {

                    console.log(
                        "ERROR TAVILY:",
                        searchError.message
                    );

                    res.writeHead(500, {
                        "Content-Type":
                            "application/json; charset=utf-8"
                    });

                    res.end(JSON.stringify({
                        success: false,
                        message:
                            "Error al buscar información",
                        error: searchError.message
                    }));

                    return;
                }


                console.log(
                    "Fuentes encontradas:",
                    webData.results
                        ? webData.results.length
                        : 0
                );

                console.log("Analizando con IA...");


                let answer;


                try {

                    answer =
                        await callAI(product, webData);

                } catch (aiError) {

                    console.log(
                        "ERROR IA:",
                        aiError.message
                    );

                    res.writeHead(500, {
                        "Content-Type":
                            "application/json; charset=utf-8"
                    });

                    res.end(JSON.stringify({
                        success: false,
                        message: aiError.message
                    }));

                    return;
                }


                let analysis;


                try {

                    analysis =
                        parseAIResponse(answer);

                    analysis =
                        validateAnalysis(
                            analysis,
                            webData.results || []
                        );

                } catch (jsonError) {

                    console.log(
                        "ERROR JSON IA:",
                        jsonError.message
                    );

                    res.writeHead(500, {
                        "Content-Type":
                            "application/json; charset=utf-8"
                    });

                    res.end(JSON.stringify({
                        success: false,
                        message:
                            "La IA no devolvió un JSON válido",
                        error: jsonError.message,
                        raw: answer
                    }));

                    return;
                }


                const sources =
                    (webData && Array.isArray(webData.results))
                        ? webData.results
                            .slice(0, 8)
                            .map(item => ({
                                title:
                                    item.title || "Fuente",
                                url:
                                    item.url || ""
                            }))
                            .filter(item => item.url)
                        : [];


                res.writeHead(200, {
                    "Content-Type":
                        "application/json; charset=utf-8"
                });

                res.end(JSON.stringify({
                    success: true,
                    analysis: analysis,
                    sources: sources
                }));


                console.log("Análisis completado.");

                console.log(
                    "Puntuación:",
                    analysis.puntuacion
                );

                console.log(
                    "================================\n"
                );

            });


            return;
        }



        // ==============================
        // HOME
        // ==============================

        res.writeHead(200, {
            "Content-Type":
                "application/json; charset=utf-8"
        });

        res.end(JSON.stringify({
            success: true,
            message: "Servidor funcionando"
        }));

    }
);



// ==================================================
// START
// ==================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log(
        "Servidor iniciado en el puerto " + PORT
    );

});