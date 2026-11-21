import { createGameServer, lanAddress } from './app.js';

const port = Number(process.env.PORT) || 3000;
const publicUrl = process.env.PUBLIC_URL;
const { httpServer } = createGameServer({
  port,
  publicUrl,
  maxRooms: Number(process.env.MAX_ROOMS) || undefined,
  idleMs: Number(process.env.ROOM_IDLE_HOURS) * 3600_000 || undefined,
});

httpServer.listen(port, () => {
  console.log(`Game server is running on port ${port}.`);
  console.log(`  This computer: http://localhost:${port}/`);
  console.log(`  Others:        ${publicUrl ?? `http://${lanAddress()}:${port}`}/`);
});
