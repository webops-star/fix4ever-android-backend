import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

router.delete('/delete-video-folder/:id', async (req, res) => {
  try {
    const folderPath = path.join(process.cwd(), 'uploads', req.params.id.replace(/[.]/g, '_'));
    await fs.rm(folderPath, { recursive: true, force: true });

    res.json({ message: 'Folder deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error });
  }
});

export default router;
