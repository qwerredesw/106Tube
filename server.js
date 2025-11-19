const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

// ========= Папки =========
const uploadsDir = path.join(__dirname, "uploads");
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// ========= Простая "база" в JSON =========
const teachersFile = path.join(dataDir, "teachers.json");
const videosFile = path.join(dataDir, "videos.json");
const requestsFile = path.join(dataDir, "requests.json");

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function initData() {
  let teachers = readJSON(teachersFile, []);
  if (!teachers.length) {
    teachers = [
      {
        id: "t_default_geography",
        name: "Людмила Петровна",
        subject: "География",
        nickname: "географичка",
      },
    ];
    writeJSON(teachersFile, teachers);
  }
  if (!fs.existsSync(videosFile)) writeJSON(videosFile, []);
  if (!fs.existsSync(requestsFile)) writeJSON(requestsFile, []);
}
initData();

// ========= Настройка Multer для загрузки видео =========
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".mp4";
    const id = "v_" + Date.now() + "_" + Math.round(Math.random() * 1e6);
    cb(null, id + ext);
  },
});
const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // до 1ГБ (можешь уменьшить)
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) {
      return cb(new Error("Можно загружать только видеофайлы"));
    }
    cb(null, true);
  },
});

// ========= Миддлвары =========
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // раздаём index.html и т.п.
app.use("/uploads", express.static(uploadsDir)); // раздаём сами видео

// ========= API: учителя =========
app.get("/api/teachers", (req, res) => {
  const teachers = readJSON(teachersFile, []);
  const videos = readJSON(videosFile, []);
  const withCounts = teachers.map((t) => ({
    ...t,
    videoCount: videos.filter((v) => v.teacherId === t.id).length,
  }));
  res.json({ teachers: withCounts });
});

// ========= API: видео =========
app.get("/api/videos", (req, res) => {
  const videos = readJSON(videosFile, []);
  const teacherId = req.query.teacherId;
  let result = videos;
  if (teacherId) {
    result = videos.filter((v) => v.teacherId === teacherId);
  }
  res.json({ videos: result });
});

app.post("/api/upload", upload.single("video"), (req, res) => {
  try {
    const teacherId = req.body.teacherId;
    const title = (req.body.title || "").toString().trim();
    const description = (req.body.description || "").toString().trim();
    const file = req.file;

    if (!teacherId) return res.status(400).json({ error: "teacherId обязателен" });
    if (!file) return res.status(400).json({ error: "Видео файл обязателен" });

    let teachers = readJSON(teachersFile, []);
    const teacherExists = teachers.some((t) => t.id === teacherId);
    if (!teacherExists) {
      return res.status(400).json({ error: "Учитель не найден" });
    }

    const videos = readJSON(videosFile, []);
    const id = path.basename(file.filename, path.extname(file.filename)); // v_...
    const video = {
      id,
      teacherId,
      title,
      description,
      fileName: file.filename,
      url: "/uploads/" + file.filename,
      createdAt: Date.now(),
    };
    videos.push(video);
    writeJSON(videosFile, videos);

    res.json({ ok: true, video });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка при загрузке видео" });
  }
});

app.delete("/api/videos/:id", (req, res) => {
  const videoId = req.params.id;
  let videos = readJSON(videosFile, []);
  const video = videos.find((v) => v.id === videoId);
  if (!video) {
    return res.status(404).json({ error: "Видео не найдено" });
  }

  // удаляем файл
  try {
    const filePath = path.join(uploadsDir, video.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error("Ошибка удаления файла", e);
  }

  videos = videos.filter((v) => v.id !== videoId);
  writeJSON(videosFile, videos);
  res.json({ ok: true });
});

// ========= API: запросы на добавление учителей =========
app.get("/api/requests", (req, res) => {
  const requests = readJSON(requestsFile, []);
  res.json({ requests });
});

app.post("/api/requests", (req, res) => {
  const { name, subject } = req.body || {};
  if (!name || !subject) {
    return res.status(400).json({ error: "name и subject обязательны" });
  }
  const requests = readJSON(requestsFile, []);
  const newRequest = {
    id: "r_" + Date.now() + "_" + Math.round(Math.random() * 1e6),
    name: String(name),
    subject: String(subject),
    status: "pending",
    createdAt: Date.now(),
  };
  requests.push(newRequest);
  writeJSON(requestsFile, requests);
  res.json({ ok: true, request: newRequest });
});

app.post("/api/requests/:id/approve", (req, res) => {
  const id = req.params.id;
  let requests = readJSON(requestsFile, []);
  const r = requests.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: "Запрос не найден" });

  r.status = "approved";
  writeJSON(requestsFile, requests);

  let teachers = readJSON(teachersFile, []);
  const exists = teachers.some(
    (t) => t.name === r.name && t.subject === r.subject
  );
  if (!exists) {
    const newTeacher = {
      id: "t_" + Date.now() + "_" + Math.round(Math.random() * 1e6),
      name: r.name,
      subject: r.subject,
      nickname: "",
    };
    teachers.push(newTeacher);
    writeJSON(teachersFile, teachers);
  }

  res.json({ ok: true });
});

app.post("/api/requests/:id/decline", (req, res) => {
  const id = req.params.id;
  let requests = readJSON(requestsFile, []);
  const r = requests.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: "Запрос не найден" });
  r.status = "declined";
  writeJSON(requestsFile, requests);
  res.json({ ok: true });
});

// ========= Старт =========
app.listen(PORT, () => {
  console.log(`106Tube server running at http://localhost:${PORT}`);
});
