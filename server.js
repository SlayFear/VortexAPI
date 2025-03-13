require("dotenv").config();
const OpenAI = require("openai");
const express = require("express");
const fs = require("fs");
const cors = require("cors");
const stringSimilarity = require("string-similarity");

const app = express();
const PORT = 3000;
const JSON_FILE = "vortex_memorias.json"; // Archivo donde se guardan los recuerdos

app.use(express.json());
app.use(cors());

// 📌 Configurar OpenRouter para usar DeepSeek R1 Zero (free)
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey:  process.env.OPENROUTER_API_KEY, // 🔥 La API Key debe estar en .env
});

// 📌 Función para limpiar texto
const normalizarTexto = (texto) => {
    if (!texto || typeof texto !== "string") return "";
    return texto.toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
};

// 📌 Función para leer recuerdos
const leerMemoria = () => {
    if (!fs.existsSync(JSON_FILE)) return { recuerdos: { memorias_importantes: [] } };
    return JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
};

// 📌 Función para guardar recuerdos
const guardarMemoria = (data) => {
    fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 4), "utf8");
};

// 📌 Función para borrar recuerdos duplicados
const limpiarDuplicados = () => {
    let data = leerMemoria();
    if (!data.recuerdos.memorias_importantes) return;

    data.recuerdos.memorias_importantes = data.recuerdos.memorias_importantes.reduce((acumulador, recuerdo) => {
        let textoNormalizado = normalizarTexto(recuerdo.texto);
        let existe = acumulador.some(r => {
            let textoExistente = normalizarTexto(r.texto);
            return stringSimilarity.compareTwoStrings(textoExistente, textoNormalizado) >= 0.7;
        });

        if (!existe) acumulador.push(recuerdo);
        return acumulador;
    }, []);

    guardarMemoria(data);
    console.log("✅ Limpieza de duplicados completada.");
};

// 📌 Función para buscar respuestas en la memoria antes de preguntar a la IA
const buscarEnMemoria = (pregunta) => {
    let memoria = leerMemoria();
    let textoPregunta = normalizarTexto(pregunta);

    // 🔍 Buscar en toda la memoria (acta_nacimiento, creador, recuerdos)
    let respuestas = [];

    // 📌 Buscar en el acta de nacimiento
    Object.entries(memoria.acta_nacimiento).forEach(([clave, valor]) => {
        if (typeof valor === "string" && stringSimilarity.compareTwoStrings(normalizarTexto(valor), textoPregunta) >= 0.5) {
            respuestas.push(`Según mi acta de nacimiento, ${clave}: ${valor}`);
        }
    });

    // 📌 Buscar en información del creador
    Object.entries(memoria.creador).forEach(([clave, valor]) => {
        if (typeof valor === "string" && stringSimilarity.compareTwoStrings(normalizarTexto(valor), textoPregunta) >= 0.5) {
            respuestas.push(`Sobre mi creador DJ, ${clave}: ${valor}`);
        }
    });

    // 🔹 Buscar en la sección "creador"
    if (textoPregunta.includes("creador") || textoPregunta.includes("quién te hizo") || textoPregunta.includes("quién te creó")) {
        respuestas.push(`Mi creador es ${memoria.creador.nombre_real}, pero todos lo conocen como DJ. Es un ingeniero en software, antes era DJ en raves y además tiene dos gatos.`);
    }


    if (textoPregunta.includes("mascotas") || textoPregunta.includes("gatos")) {
        let mascotas = memoria.creador.mascotas.map(m => `${m.nombre}, ${m.descripcion}`).join(", ");
        respuestas.push(`DJ tiene estas mascotas: ${mascotas}.`);
    }

    if (textoPregunta.includes("promesas") || textoPregunta.includes("recuerdos importantes")) {
        let promesas = memoria.recuerdos.promesa.map(p => `- ${p}`).join("\n");
        respuestas.push(`Estas son algunas de mis promesas:\n${promesas}`);
    }
    

    // 📌 Buscar en recuerdos importantes
    memoria.recuerdos.memorias_importantes.forEach((recuerdo) => {
        if (stringSimilarity.compareTwoStrings(normalizarTexto(recuerdo.texto), textoPregunta) >= 0.5) {
            respuestas.push(`Recuerdo esto: "${recuerdo.texto}"`);
        }
    });

    // 📌 Si encontró respuestas en la memoria, las devuelve en un solo texto
    if (respuestas.length > 0) {
        return respuestas.join("\n");
    }

    return null; // Si no encontró nada, devuelve null para preguntar a la IA
};

// 📌 Función para hacer preguntas a la IA
async function preguntarAVortex(pregunta) {
    // 🔍 Buscar en la memoria antes de preguntar a la IA
    const respuestaMemoria = buscarEnMemoria(pregunta);
    if (respuestaMemoria) {
        console.log("🔍 Respuesta encontrada en la memoria:", respuestaMemoria);
        return respuestaMemoria; // Si encontró algo relevante, lo devuelve sin preguntar a la IA
    }
    console.log("🧐 No encontré la respuesta en la memoria, preguntando a la IA...");

    try {
        const respuesta = await openai.chat.completions.create({
            model: "google/gemini-2.0-flash-exp:free",
            messages: [{ role: "user", content: pregunta }],
            stream: false,
        });

        return respuesta.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ Error al conectar con OpenRouter:", error);

        if (error.status === 402) {
            return "Error: No tengo saldo en OpenRouter. 😞 Recarga tu cuenta o prueba otra API gratuita.";
        }

        return "Error al procesar tu pregunta.";
    }
}

// 📌 Endpoint para hacer preguntas a Vortex
app.post("/preguntar", async (req, res) => {
    const { pregunta } = req.body;
    if (!pregunta) return res.status(400).json({ error: "Falta la pregunta en el cuerpo de la solicitud." });

    console.log("📝 Pregunta recibida:", pregunta);

    // 🔍 Primero buscamos en la memoria
    let respuestaMemoria = buscarEnMemoria(pregunta);
    if (respuestaMemoria) {
        console.log("🔍 Respuesta encontrada en la memoria:", respuestaMemoria);
        return res.json({ pregunta, respuesta: respuestaMemoria });
    }

    // 🤖 Si no hay respuesta en la memoria, preguntamos a la IA
    const respuestaIA = await preguntarAVortex(pregunta);
    console.log("🔍 Respuesta de la IA:", respuestaIA);

    // 🧠 Guardar respuestas importantes en la memoria
    // if (respuestaIA.length > 10) { // Solo guarda respuestas largas
    //     let data = leerMemoria();
    //     data.recuerdos.memorias_importantes.push({ texto: respuestaIA, fecha: new Date().toISOString() });
    //     guardarMemoria(data);
    // }

    res.json({ pregunta, respuesta: respuestaIA });
});

// 📌 Endpoint para agregar un recuerdo manualmente
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

// 📌 Endpoint para actualizar recuerdos
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

// 📌 Endpoint para olvidar recuerdos
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

// 📌 Endpoint para obtener recuerdos
app.get("/recuerdos", (req, res) => {
    res.json(leerMemoria());
});

// 📌 Iniciar el servidor
app.listen(PORT, () => {
    console.log(`🚀 API de Vortex corriendo en http://localhost:${PORT}`);
});
