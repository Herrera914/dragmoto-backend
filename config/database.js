const mongoose = require('mongoose');

// Si Mongo falla, reintenta en vez de tumbar el servidor:
// así el dashboard y el polling de la moto siguen respondiendo.
const RETRY_MS = 10000;

const connectDB = async () => {
    if (!process.env.MONGO_URI) {
        console.error('❌ Falta la variable MONGO_URI — configúrala en Railway → Variables');
        return;
    }
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log(`✅ MongoDB conectado: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ Error conectando a MongoDB: ${error.message}`);
        console.error(`   Reintentando en ${RETRY_MS / 1000}s...`);
        setTimeout(connectDB, RETRY_MS);
    }
};

module.exports = connectDB;
