import express from 'express';
import { config } from 'dotenv';
import pkg from 'pg';
import fs from "fs"
import admin from "firebase-admin" 
import cors from "cors"
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import path from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url));
// Import the entire module as `pkg`

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../dist')));

const credentials = JSON.parse(
  fs.readFileSync('../credentials.json')
)

admin.initializeApp({
  credential: admin.credential.cert(credentials),
})

const { Pool } = pkg; // Destructure `Pool` from `pkg`

// Load environment variables from .env file
config();




// Create a pool instance using environment variables
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  PORT: process.env.DB_PORT,
});

// Test connection
const testConnection = async () => {
  try {
    const result = await pool.query('SELECT * FROM articles');

    if (result.rows.length === 0) {
      console.error('No rows found in the table');
      process.exit(1);
    }
    console.log('Connected to the PostgreSQL database:', result.rows);
  } catch (error) {
    console.error('Error connecting to the database:', error.stack);
    process.exit(1);
  }
};

testConnection(); // Invoke testConnection to test the connection



app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Accept-Language, Accept-Encoding, authtoken'); // Add authtoken to the list
  next();
});

app.use(cors({
  origin: ['http://localhost:5173'],
  allowedHeaders: ['Authorization', 'Content-Type', 'authtoken'], // Add authtoken to the list
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.options('/api/*', (req, res) => {
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Accept-Language, Accept-Encoding');
  res.send(200);
});

app.use(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
    } catch (error) {
      console.error('Error verifying auth token:', error);
      return res.status(403).json({ error: 'Unauthorized' });
    }
  } else {
    req.user = {}; // Set req.user to an empty object if no token is present
  }

  next();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

app.get('/api/articles/:articleId', async (req, res) => {
  const articleId = parseInt(req.params.articleId);
  const {uid} = req.user;

  const query = {
    text: `SELECT * FROM articles WHERE id = $1`,
    values: [articleId],
  };

  try {
    const result = await pool.query(query);
    const article = result.rows[0];
    if (!article) {
      res.status(404).send({ message: 'Article not found' });
    } else {
      const upvoteIds = article.upvoteIds || [];
      article.canUpvote = uid && !upvoteIds.includes(uid);
      res.send(article);
    }
  } catch (error) {
    console.error('Error executing query:', error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});

app.use((req, res, next) =>{
  if (req.user){
    next()
  }
  else{
    res.status(401).send({ message: 'Unauthorized' })
  }
});


app.put('/api/articles/:articleId/upvote', async (req, res) => {
  const { articleId } = req.params;
  const { uid } = req.user;

  const query = {
    text: `SELECT * FROM articles WHERE id = $1`,
    values: [articleId],
  };

  try {
    const result = await pool.query(query);
    const article = result.rows[0];
    if (article) {
      const upvoteIds = article.upvoteIds || [];
      const canUpvote = !upvoteIds.includes(uid); // Check if uid is not in upvoteIds

      if (canUpvote) {
        const updateQuery = {
          text: `UPDATE articles 
                 SET upvote = upvote + 1, 
                     upvoteIds = array_append(upvoteIds, $2) 
                 WHERE id = $1 RETURNING *`,
          values: [articleId, uid],
        };

        const result = await pool.query(updateQuery);
        const updatedArticle = result.rows[0];
        res.json(updatedArticle);
      } else {
        res.status(403).json({ error: 'You have already upvoted this article' });
      }
    } else {
      res.status(404).send({ message: 'Article not found' });
    }
  } catch (error) {
    console.error('Error executing query:', error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});




app.post("/api/articles/:articleId/comment", async (req, res) => {
  const { articleId } = req.params;
  const { text } = req.body;
  
  if (!req.user || !req.user.email) {
    return res.status(403).json({ error: 'User not authenticated' });
  }

  const { email } = req.user;
  const comment = ` ${text} - ${email}`;

  try {
    const result = await pool.query(
      'UPDATE articles SET comment = array_append(comment, $1) WHERE id = $2 RETURNING *',
      [comment, articleId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error executing query:', error.stack);
    res.status(500).send('Internal Server Error');
  }
});
app.listen(PORT, () => {
  console.log("Server running at " + PORT );
});

export default pool;


