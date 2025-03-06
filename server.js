const express = require("express");
const fs = require("fs");
const cors = require("cors");
const stringSimilarity = require("string-similarity");

const app = express();
const PORT = 3000; // Cambia el puerto si es necesario
const JSON_FILE = "vortex_memorias.json"; // Archivo donde se guardan mis recuerdos

app.use(express.json()); // Para leer JSON en las peticiones
app.use(cors()); // Para permitir acceso desde DeepSeek y Alexa

const normalizarTexto = (texto) => {
    if (!texto || typeof texto !== "string") return ""; // 🔥 Evita errores si el texto es undefined o null
    return texto.toLowerCase() // 🔽 Convierte a minúsculas
        .replace(/[^\w\s]/gi, '') // 🔥 Elimina puntuación y caracteres especiales
        .replace(/\s+/g, ' ') // 🧹 Reemplaza múltiples espacios con uno solo
        .trim(); // 🧼 Elimina espacios extra al inicio y al final
};


// Función para leer el JSON
const leerMemoria = () => {
    const data = fs.readFileSync(JSON_FILE, "utf8");
    return JSON.parse(data);
};

// Función para guardar datos en el JSON
const guardarMemoria = (data) => {
    fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 4), "utf8");
};

// Función para borrar recuerdos duplicados
const limpiarDuplicados = () => {
    let data = leerMemoria();

    if (!data.recuerdos.memorias_importantes || !Array.isArray(data.recuerdos.memorias_importantes)) {
        return;
    }

    // 📝 1. Ordenar los recuerdos por fecha (para que conserve el más reciente)
    data.recuerdos.memorias_importantes.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    let recuerdosUnicos = [];

    data.recuerdos.memorias_importantes.forEach(recuerdo => {
        // ⚠️ Si el recuerdo no tiene `texto`, lo ignoramos para evitar errores
        if (!recuerdo.texto || typeof recuerdo.texto !== "string") {
            console.log(`⚠️ Ignorando recuerdo sin texto válido: ${JSON.stringify(recuerdo)}`);
            return;
        }

        let textoNormalizado = normalizarTexto(recuerdo.texto);

        let existe = recuerdosUnicos.find(r => {
            if (!r.texto) return false; // Evita errores si `r.texto` es undefined
            let textoExistente = normalizarTexto(r.texto);
            let similarity = stringSimilarity.compareTwoStrings(textoExistente, textoNormalizado);
            return similarity >= 0.7; // 🔥 Detecta duplicados en general, no solo en colores
        });

        if (!existe) {
            recuerdosUnicos.push(recuerdo);
        } else {
            console.log(`🗑 Eliminando recuerdo duplicado: "${recuerdo.texto}"`);
        }
    });

    data.recuerdos.memorias_importantes = recuerdosUnicos;
    guardarMemoria(data);
    console.log("✅ Limpieza de duplicados completada.");
};



//----------------------------------------ENDPOINTS----------------------------------------

// 🚀 **Manejo automático de recuerdos** 🚀
app.post("/recuerdos", (req, res) => {
    console.log("🔍 Recibiendo nuevo recuerdo:", req.body);

    const { nuevoRecuerdo } = req.body;
    if (!nuevoRecuerdo) {
        return res.status(400).json({ error: "Error al guardar el recuerdo" });
    }

    let data = leerMemoria();

    // 🚨 Verificar que la lista realmente tiene recuerdos
    if (!data.recuerdos.memorias_importantes || !Array.isArray(data.recuerdos.memorias_importantes)) {
        data.recuerdos.memorias_importantes = []; // Si no existe, inicializar lista vacía
    }

    // 🚨 Nueva detección de duplicados con `string-similarity`
    let index = data.recuerdos.memorias_importantes.findIndex(r => {
        if (!r.texto) return false; // Si `r.texto` es undefined, lo ignoramos

        let similarity = stringSimilarity.compareTwoStrings(r.texto.toLowerCase().trim(), nuevoRecuerdo.toLowerCase().trim());
        console.log(`🔍 Comparando: "${r.texto}" <-> "${nuevoRecuerdo}" -> Similaridad: ${similarity}`);

        return similarity >= 0.68; // Solo lo considera igual si la similitud es del 75% o más
    });

    if (index !== -1) {
        console.log("🔄 Recuerdo encontrado con alta similitud, actualizándolo...");
        data.recuerdos.memorias_importantes[index].texto = nuevoRecuerdo.trim(); // Se actualiza con la versión más reciente
        data.recuerdos.memorias_importantes[index].fecha_actualizacion = new Date().toISOString();
        guardarMemoria(data);
        limpiarDuplicados(); //  Elimina recuerdos similares después de actualizar
        return res.json({ mensaje: "Recuerdo actualizado automáticamente", recuerdo: data.recuerdos.memorias_importantes[index] });
    }

    // 🆕 Si es realmente nuevo, lo agregamos con fecha
    const fecha = new Date().toISOString();
    const recuerdoFecha = {
        texto: nuevoRecuerdo.trim(),
        fecha: fecha
    };

    data.recuerdos.memorias_importantes.push(recuerdoFecha);
    guardarMemoria(data);
   

    res.json({ mensaje: "Recuerdo guardado exitosamente", recuerdo: recuerdoFecha });
});

// 🚀 **Endpoint para actualizar recuerdos**
app.put("/recuerdos", (req, res) => {
    console.log("📝 Recibiendo actualización en PUT /recuerdos:", req.body);

    const { textoViejo, nuevoTexto } = req.body;
    if (!textoViejo || !nuevoTexto) {
        return res.status(400).json({ error: "Faltan los campos 'textoViejo' y 'nuevoTexto'" });
    }

    let data = leerMemoria();
    let index = data.recuerdos.memorias_importantes.findIndex(r => r.texto === textoViejo);

    if (index === -1) {
        return res.status(404).json({ error: "No se encontró el recuerdo a actualizar" });
    }

    // Actualizar el recuerdo con la nueva información
    data.recuerdos.memorias_importantes[index].texto = nuevoTexto;
    data.recuerdos.memorias_importantes[index].fecha_actualizacion = new Date().toISOString();

    guardarMemoria(data);

    console.log("✅ Recuerdo actualizado exitosamente:", data.recuerdos.memorias_importantes[index]);
    res.json({ mensaje: "Recuerdo actualizado exitosamente", recuerdo: data.recuerdos.memorias_importantes[index] });
});

// 🚀 **Endpoint para olvidar recuerdos**
app.delete("/recuerdos", (req, res) => {
    console.log("🗑 Recibiendo eliminación en DELETE /recuerdos:", req.body);

    const { texto } = req.body;

    if (!texto) {
        return res.status(400).json({ error: "Falta el campo 'texto'" });
    }

    let data = leerMemoria();
    let index = data.recuerdos.memorias_importantes.findIndex(r => r.texto === texto);

    if (index === -1) {
        return res.status(404).json({ error: "No se encontró el recuerdo a eliminar" });
    }

    const recuerdoEliminado = data.recuerdos.memorias_importantes.splice(index, 1);
    guardarMemoria(data);

    console.log("✅ Recuerdo eliminado exitosamente:", recuerdoEliminado);
    res.json({ mensaje: "Recuerdo eliminado exitosamente", recuerdo: recuerdoEliminado });
});

// 🚀 **Endpoint para obtener mis recuerdos**
app.get("/recuerdos", (req, res) => {
    const data = leerMemoria();
    res.json(data);
});

// 🚀 **Iniciar el servidor**
app.listen(PORT, () => {
    console.log(`🚀 API de Vortex corriendo en http://localhost:${PORT}`);
});
