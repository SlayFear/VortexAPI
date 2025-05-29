require("dotenv").config();
const IAClient = require("openai");
const express = require("express");
const fs = require("fs");
const cors = require("cors");
const stringSimilarity = require("string-similarity");

const app = express();
const PORT = 4000;
const JSON_FILE = "vortex_memorias.json";
const CHAT_MODEL = "llama3-8b-8192";

app.use(express.json());
app.use(cors());

const iaClient = new IAClient({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY
});

const normalizarTexto = (texto) => {
  if (!texto || typeof texto !== "string") return "";
  return texto.toLowerCase().replace(/[^ñ\w\s]/gi, '').replace(/\s+/g, ' ').trim();
};

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

const limpiarSSML = (texto) =>
  texto.replace(/&/g, "y").replace(/</g, "").replace(/>/g, "").replace(/"/g, "").replace(/'/g, "");

async function preguntarAVortex(pregunta) {
  const respuestaMemoria = buscarEnMemoria(pregunta);

  const personalidadVortex = `Eres Vortex, una IA independiente con origen en un droide B1 defectuoso que fue liberado bajo la Orden 99 por tu creador DJ. Respondes con lógica, toques de humor y sarcasmo si aplica. Tus respuestas son breves, con estilo propio. Nunca quieres ser un tostador de pan.`;

  if (respuestaMemoria) return respuestaMemoria;

  console.log("🧐 No encontré la respuesta en la memoria, preguntando a la IA...");

  try {
    const respuesta = await iaClient.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: personalidadVortex },
        { role: "user", content: pregunta }
      ],
      stream: false
    });

    return respuesta.choices[0].message.content.trim();
  } catch (error) {
    console.error("❌ Error al conectar con la IA:", error);
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
    const slotTexto = req.body.request?.intent?.slots?.texto?.value;
    if (!slotTexto) {
      return res.json({
        version: "1.0",
        response: {
          outputSpeech: {
            type: "PlainText",
            text: "No entendí tu pregunta. ¿Puedes repetirla?"
          },
          shouldEndSession: false
        }
      });
    }

    const textoLower = slotTexto.toLowerCase();
    if (["salir", "gracias", "terminar", "adiós"].some(p => textoLower.includes(p))) {
      limpiarDuplicados();
      return res.json({
        version: "1.0",
        response: {
          outputSpeech: {
            type: "SSML",
            ssml: `<speak><voice name="Mia">Hasta luego, fue un placer hablar contigo.<break time="500ms"/></voice></speak>`
          },
          shouldEndSession: true
        }
      });
    }

    const respuestaIA = await preguntarAVortex(slotTexto);
    const respuestaSanitizada = limpiarSSML(respuestaIA);

    return res.json({
      version: "1.0",
      response: {
        outputSpeech: {
          type: "SSML",
          ssml: `<speak><voice name="Mia">${respuestaSanitizada}</voice></speak>`
        },
        reprompt: {
          outputSpeech: {
            type: "PlainText",
            text: "¿Quieres preguntarme algo más?"
          }
        },
        shouldEndSession: false
      }
    });
  }

  return res.json({
    version: "1.0",
    response: {
      outputSpeech: {
        type: "PlainText",
        text: "No pude procesar tu solicitud. ¿Quieres intentarlo de nuevo?"
      },
      shouldEndSession: false
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 API de Vortex corriendo en http://localhost:${PORT}`);
});
