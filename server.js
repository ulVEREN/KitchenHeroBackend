import express from "express";
import sql from "mssql";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Konfigurasjon for Microsoft SQL Server
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

// Koble til databasen før serveren starter
async function connectToDatabase() {
  try {
    await sql.connect(dbConfig);
    console.log("✅ Tilkoblet til SQL Server");
  } catch (err) {
    console.error("❌ Feil ved tilkobling til SQL Server:", err);
    process.exit(1);
  }
}

// 📌 Hente alle rader med registreringer
app.get("/rows", async (req, res) => {
  try {
    const result = await sql.query(`
      SELECT r.id, r.name, 
      COALESCE(
        (
          SELECT STRING_AGG(reg.registration_date, ',') 
          FROM registrations reg 
          WHERE reg.row_id = r.id
        ), ''
      ) AS registrations
      FROM rows r
    `);

    const rows = result.recordset.map((row) => ({
      id: row.id,
      name: row.name,
      registrations: row.registrations ? row.registrations.split(",") : [],
    }));

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📌 Legge til en ny rad
app.post("/rows", async (req, res) => {
  try {
    const { name } = req.body;

    const query = `INSERT INTO rows (name) OUTPUT INSERTED.* VALUES (@name)`;
    const request = new sql.Request();
    request.input("name", sql.NVarChar, name);
    const result = await request.query(query);

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📌 Registrere en ny hendelse for en rad
app.post("/registrations", async (req, res) => {
  try {
    const { rowId, date } = req.body;

    if (!rowId || !date) {
      return res.status(400).json({ error: "rowId og date er påkrevd" });
    }

    // Sjekk om registreringen allerede finnes
    const checkQuery = `
      SELECT COUNT(*) AS count FROM registrations WHERE row_id = @rowId AND registration_date = @date
    `;
    const checkRequest = new sql.Request();
    checkRequest.input("rowId", sql.Int, rowId);
    checkRequest.input("date", sql.Date, date);
    const checkResult = await checkRequest.query(checkQuery);

    if (checkResult.recordset[0].count > 0) {
      return res.status(409).json({ error: "Registrering finnes allerede" });
    }

    // Hvis den ikke finnes, legg den til
    const query = `
      INSERT INTO registrations (row_id, registration_date) 
      VALUES (@rowId, @date)
    `;

    const request = new sql.Request();
    request.input("rowId", sql.Int, rowId);
    request.input("date", sql.Date, date);

    await request.query(query);
    res.status(201).json({ message: "Registrering lagret" });
  } catch (err) {
    console.error("❌ Feil ved registrering:", err);
    res.status(500).json({ error: "Feil ved registrering av data" });
  }
});

// 📌 Slette en registrering
app.delete("/registrations", async (req, res) => {
  try {
    const { rowId, date } = req.body;

    if (!rowId || !date) {
      return res.status(400).json({ error: "rowId og date er påkrevd" });
    }

    console.log("🗑️ Sletter registrering:", { rowId, date });

    const query = `
      DELETE FROM registrations 
      WHERE row_id = @rowId AND registration_date = @date
    `;

    const request = new sql.Request();
    request.input("rowId", sql.Int, rowId);
    request.input("date", sql.Date, date);

    const result = await request.query(query);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Ingen registrering funnet" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Feil ved sletting av registrering:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 Oppdatere en rad
app.put("/rows/:id", async (req, res) => {
  try {
    const { name } = req.body;
    const { id } = req.params;

    const query = `
      UPDATE rows 
      SET name = @name
      WHERE id = @id
    `;

    const request = new sql.Request();
    request.input("id", sql.Int, id);
    request.input("name", sql.NVarChar, name);

    await request.query(query);
    res.json({ id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 📌 Slette en rad
app.delete("/rows/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `DELETE FROM rows WHERE id = @id`;

    const request = new sql.Request();
    request.input("id", sql.Int, id);
    await request.query(query);

    console.log(`🗑️ Rad med ID ${id} slettet fra databasen.`);
    res.json({ message: "Rad slettet" });
  } catch (err) {
    console.error("❌ Feil ved sletting av rad:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 Hent leaderboard for tidligere måneder
app.get("/leaderboard", async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: "Må oppgi year og month som parametre" });
    }

    const query = `
      SELECT r.id, r.name, COUNT(reg.registration_date) AS total
      FROM rows r
      LEFT JOIN registrations reg
      ON r.id = reg.row_id
      WHERE YEAR(reg.registration_date) = @year AND MONTH(reg.registration_date) = @month
      GROUP BY r.id, r.name
      ORDER BY total DESC
    `;

    const request = new sql.Request();
    request.input("year", sql.Int, year);
    request.input("month", sql.Int, month);
    
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Feil ved henting av leaderboard:", err);
    res.status(500).json({ error: "Feil ved henting av leaderboard" });
  }
});

// 📌 Start serveren
connectToDatabase().then(() => {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => {
    console.log(`🚀 Server kjører på port ${PORT}`);
  });
});
