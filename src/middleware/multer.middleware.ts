import multer from 'multer';
import fs from 'fs';
import path from 'path';

// Ensure upload directory exists — absolute path so it works regardless of process.cwd()
const uploadDir = path.join(__dirname, '../../public/temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create a unique filename with original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit (increased for PDF/DOC files)
  },
  fileFilter: (req, file, cb) => {
    // Accept images, PDFs, and document files
    const allowedExtensions = /\.(jpg|jpeg|png|gif|pdf|doc|docx)$/i;
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.includes(file.mimetype.toLowerCase());

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      const error = new Error(
        'Invalid file type! Only images (JPG, PNG, GIF), PDF, and Word documents (DOC, DOCX) are allowed.'
      );
      return cb(error as any);
    }
  },
});
