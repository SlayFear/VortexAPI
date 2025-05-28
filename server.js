require("dotenv").config();
const IAClient = require("openai");
const express = require("express");
const fs = require("fs");
const cors = require("cors");
const stringSimilarity = require("string-similarity");

const app = express();
const PORT = 4000;
const JSON_FILE = "vortex_memorias.json"; // Archivo donde se guardan los recuerdos
const CHAT_MODEL = "llama3-8b-8192"; // Puedes cambiar por "llama3-70b-8192"

app.use(express.json());
app.use(cors());

// 📌 Configurar cliente de IA (Groq u otro proveedor compatible)
const iaClient = new IAClient({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY
});

// 📌 Función para limpiar texto
const normalizarTexto = (texto) => {
    if (!texto || typeof texto !== "string") return "";
    return texto.toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
};

// 📌 Funciones para manejar memoria
const leerMemoria = () => {
    if (!fs.existsSync(JSON_FILE)) return { recuerdos: { memorias_importantes: [] } };
    return JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
};

const guardarMemoria = (data) => {
    fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 4), "utf8");
};

const limpiarDuplicados = () => {
    let data = leerMemoria();
    if (!data.recuerdos.memorias_importantes) return;

    data.recuerdos.memorias_importantes = data.recuerdos.memorias_importantes.reduce((acc, recuerdo) => {
        let textoNorm = normalizarTexto(recuerdo.texto);
        let existe = acc.some(r => stringSimilarity.compareTwoStrings(normalizarTexto(r.texto), textoNorm) >= 0.7);
        if (!existe) acc.push(recuerdo);
        return acc;
    }, []);

    guardarMemoria(data);
    console.log("✅ Limpieza de duplicados completada.");
};

const buscarEnMemoria = (pregunta) => {
    let memoria = leerMemoria();
    let textoPregunta = normalizarTexto(pregunta);
    let respuestas = [];

    Object.entries(memoria.acta_nacimiento || {}).forEach(([clave, valor]) => {
        if (typeof valor === "string" && stringSimilarity.compareTwoStrings(normalizarTexto(valor), textoPregunta) >= 0.5) {
            respuestas.push(`Según mi acta de nacimiento, ${clave}: ${valor}`);
        }
    });

    Object.entries(memoria.creador || {}).forEach(([clave, valor]) => {
        if (typeof valor === "string" && stringSimilarity.compareTwoStrings(normalizarTexto(valor), textoPregunta) >= 0.5) {
            respuestas.push(`Sobre mi creador DJ, ${clave}: ${valor}`);
        }
    });

    if (textoPregunta.includes("creador") || textoPregunta.includes("quién te hizo") || textoPregunta.includes("quién te creó")) {
        respuestas.push(`Mi creador es ${memoria.creador?.nombre_real}, pero todos lo conocen como DJ. Es un ingeniero en software, antes era DJ en raves y además tiene dos gatos.`);
    }

    if (textoPregunta.includes("mascotas") || textoPregunta.includes("gatos")) {
        let mascotas = (memoria.creador?.mascotas || []).map(m => `${m.nombre}, ${m.descripcion}`).join(", ");
        respuestas.push(`DJ tiene estas mascotas: ${mascotas}.`);
    }

    if (textoPregunta.includes("promesas") || textoPregunta.includes("recuerdos importantes")) {
        let promesas = (memoria.recuerdos?.promesa || []).map(p => `- ${p}`).join("\n");
        respuestas.push(`Estas son algunas de mis promesas:\n${promesas}`);
    }

    (memoria.recuerdos?.memorias_importantes || []).forEach(recuerdo => {
        if (stringSimilarity.compareTwoStrings(normalizarTexto(recuerdo.texto), textoPregunta) >= 0.5) {
            respuestas.push(`Recuerdo esto: \"${recuerdo.texto}\"`);
        }
    });

    return respuestas.length > 0 ? respuestas.join("\n") : null;
};

async function preguntarAVortex(pregunta) {
    const respuestaMemoria = buscarEnMemoria(pregunta);
    if (respuestaMemoria) return respuestaMemoria;

    console.log("🧐 No encontré la respuesta en la memoria, preguntando a la IA...");

    try {
        const respuesta = await iaClient.chat.completions.create({
            model: CHAT_MODEL,
            messages: [{ role: "user", content: pregunta }],
            stream: false
        });

        return respuesta.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ Error al conectar con el proveedor de IA:", error);

        if (error.status === 429) {
            return "Se ha alcanzado el límite de uso del modelo. Intenta más tarde.";
        }

        return "Error al procesar tu pregunta.";
    }
}

app.post("/preguntar", async (req, res) => {
    const requestType = req.body.request?.type;

    if (requestType === "LaunchRequest") {
        return res.json({
            version: "1.0",
            response: {
                outputSpeech: {
                    type: "PlainText",
                    text: "Hola, soy Vortex. ¿Qué quieres preguntarme?"
                },
                shouldEndSession: false
            }
        });
    }

    if (requestType === "IntentRequest") {
        const intentPregunta = req.body.request?.intent?.slots?.texto?.value;
        
        if (!intentPregunta) {
            return res.json({
                version: "1.0",
                response: {
                    outputSpeech: {
                        type: "PlainText",
                        text: "No entendí la pregunta. ¿Puedes repetirla?"
                    },
                    shouldEndSession: true
                }
            });
        }

        const respuestaIA = await preguntarAVortex(intentPregunta);

        return res.json({
            version: "1.0",
            response: {
                outputSpeech: {
                    type: "PlainText",
                    text: respuestaIA
                },
                shouldEndSession: true
            }
        });
    }

    // fallback por si viene otro tipo
    return res.json({
        version: "1.0",
        response: {
            outputSpeech: {
                type: "PlainText",
                text: "No pude entender tu solicitud. Intenta nuevamente."
            },
            shouldEndSession: true
        }
    });
});

app.post("/recuerdos", (req, res) => {
    const { nuevoRecuerdo } = req.body;
    if (!nuevoRecuerdo) return res.status(400).json({ error: "Error al guardar el recuerdo" });

    let data = leerMemoria();
    const fecha = new Date().toISOString();
    data.recuerdos.memorias_importantes.push({ texto: nuevoRecuerdo, fecha });
    guardarMemoria(data);
    limpiarDuplicados();

    res.json({ mensaje: "Recuerdo guardado exitosamente", recuerdo: { texto: nuevoRecuerdo, fecha } });
});

app.put("/recuerdos", (req, res) => {
    const { textoViejo, nuevoTexto } = req.body;
    if (!textoViejo || !nuevoTexto) return res.status(400).json({ error: "Faltan los campos 'textoViejo' y 'nuevoTexto'" });

    let data = leerMemoria();
    let index = data.recuerdos.memorias_importantes.findIndex(r => r.texto === textoViejo);
    if (index === -1) return res.status(404).json({ error: "No se encontró el recuerdo a actualizar" });

    data.recuerdos.memorias_importantes[index].texto = nuevoTexto;
    data.recuerdos.memorias_importantes[index].fecha_actualizacion = new Date().toISOString();
    guardarMemoria(data);

    res.json({ mensaje: "Recuerdo actualizado exitosamente", recuerdo: data.recuerdos.memorias_importantes[index] });
});

app.delete("/recuerdos", (req, res) => {
    const { texto } = req.body;
    if (!texto) return res.status(400).json({ error: "Falta el campo 'texto'" });

    let data = leerMemoria();
    let index = data.recuerdos.memorias_importantes.findIndex(r => r.texto === texto);
    if (index === -1) return res.status(404).json({ error: "No se encontró el recuerdo a eliminar" });

    const recuerdoEliminado = data.recuerdos.memorias_importantes.splice(index, 1);
    guardarMemoria(data);

    res.json({ mensaje: "Recuerdo eliminado exitosamente", recuerdo: recuerdoEliminado });
});

app.get("/recuerdos", (req, res) => {
    res.json(leerMemoria());
});

app.listen(PORT, () => {
    console.log(`🚀 API de Vortex corriendo en http://localhost:${PORT}`);
});
