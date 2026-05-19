import { Server } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

function parseCookies(cookieString: string): Record<string, string> {
  const list: Record<string, string> = {};
  cookieString.split(';').forEach(function (cookie) {
    let [name, ...rest] = cookie.split('=');
    name = name.trim();
    if (name) {
      list[name] = decodeURIComponent(rest.join('=').trim());
    }
  });
  return list;
}

/* const activeSimulations = new Map<string, NodeJS.Timeout>();
const simulatedLocations = new Map<string, { lat: number; lng: number }>();

function simulateMovement(currentLoc: { lat: number; lng: number }): { lat: number; lng: number } {
    const deltaLat = (Math.random() - 0.5) * 0.0005;
    const deltaLng = (Math.random() - 0.5) * 0.0005;
    return {
        lat: currentLoc.lat + deltaLat,
        lng: currentLoc.lng + deltaLng,
    };
} */

export function createSocketServer(httpServer: HTTPServer) {
  // Explicit allowed origins - credentials:true requires exact origins, never '*'
  const allowedOrigins = [
    ...(process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : []),
    process.env.FRONTEND_URL,
    'https://fix4ever.com',
    'https://www.fix4ever.com',
    'https://dev.fix4ever.com',
    'https://www.dev.fix4ever.com',
    'https://main.d3901fw5qiteft.amplifyapp.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
  ].filter(Boolean) as string[];

  const io = new Server(httpServer, {
    cors: {
      origin: function (origin, callback) {
        // Allow server-to-server requests (no origin header)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        console.warn(`Socket.IO CORS blocked origin: ${origin}`);
        callback(new Error(`Origin ${origin} not allowed`));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    // polling first: always works through proxies/load balancers,
    // then upgrades to WebSocket when infrastructure supports it
    transports: ['polling', 'websocket'],
    allowEIO3: true,
  });

  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie;

    if (!cookieHeader) {
      return next(new Error('Authentication error: No cookies provided.'));
    }

    const cookies = parseCookies(cookieHeader);

    const token = cookies.token || socket.handshake.query?.token || socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication error: 'token' cookie not found."));
    }
    try {
      const jwtSecret = process.env.JWT_SECRET!;
      if (!jwtSecret) {
        return next(new Error('Server configuration error: JWT secret missing.'));
      }

      const decoded = jwt.verify(token, jwtSecret);

      (socket as any).user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', socket => {
    const userId = (socket as any).user?.userId;
    const userRole = (socket as any).user?.role;

    if (userId) {
      // Join user's personal room for notifications
      socket.join(`user-${userId}`);
      // Admins also join the shared admin-notifications room
      if (userRole === 'admin') {
        socket.join('admin-notifications');
        console.log(`🔐 Admin ${userId} joined admin-notifications room`);
      }
      console.log(
        `✅ User ${userId} (${userRole}) connected to socket ${socket.id} from ${socket.handshake.address}`
      );
    } else {
      console.warn(`⚠️ Socket ${socket.id} connected without userId`);
    }

    socket.on('join-order', (orderId: string) => {
      console.log(`Socket ${socket.id} joining order room: ${orderId}`);
      socket.join(orderId);
    });

    socket.on('location-update', ({ orderId, lat, lng }) => {
      io.to(orderId).emit('location-update', { lat, lng }); // This is for if a real delivery app sends updates
    });

    socket.on('join-service-request', (requestId: string) => {
      console.log(`Socket ${socket.id} joining service request room: ${requestId}`);
      socket.join(`service-${requestId}`);
    });

    // ─── WebRTC Signaling ────────────────────────────────────────────────────

    // Both broadcaster and viewer call this on connect.
    // We notify existing peers so the broadcaster knows a viewer has arrived.
    socket.on('join-room', (roomId: string) => {
      const existingPeers = io.sockets.adapter.rooms.get(roomId);

      socket.join(roomId);
      socket.join(`service-${roomId}`);

      (socket as any).rtcRoom = roomId;

      if (existingPeers && existingPeers.size > 0) {
        existingPeers.forEach(peerId => {
          io.to(peerId).emit('peer-joined', { socketId: socket.id });
        });
        console.log(`🔔 Notified ${existingPeers.size} peer(s) in room ${roomId} of new joiner`);
      }

      console.log(`📡 Socket ${socket.id} joined WebRTC room ${roomId}`);
    });

    // Broadcaster → relay offer to all viewers in the room
    socket.on(
      'offer',
      ({ roomId, offer }: { roomId: string; offer: RTCSessionDescriptionInit }) => {
        console.log(`📤 Relaying offer in room ${roomId}`);
        socket.to(roomId).emit('offer', offer);
      }
    );

    // Viewer → relay answer back to the broadcaster
    socket.on(
      'answer',
      ({ roomId, answer }: { roomId: string; answer: RTCSessionDescriptionInit }) => {
        console.log(`📥 Relaying answer in room ${roomId}`);
        socket.to(roomId).emit('answer', answer);
      }
    );

    // Either side → relay ICE candidates to the other peer(s)
    socket.on(
      'ice',
      ({ roomId, candidate }: { roomId: string; candidate: RTCIceCandidateInit }) => {
        socket.to(roomId).emit('ice', candidate);
      }
    );

    // Viewer → ask broadcaster to re-send its offer (handles late joiners)
    socket.on('request-offer', ({ roomId }: { roomId: string }) => {
      console.log(`📨 Relaying offer-request in room ${roomId}`);
      socket.to(roomId).emit('request-offer');
    });

    // ────────────────────────────────────────────────────────────────────────

    socket.on('join-captain-requests', () => {
      socket.join('captain-new-requests');
      console.log(`Captain socket ${socket.id} joined captain-new-requests room`);
    });

    socket.on('join-vendor-room', (userId: any) => {
      socket.join(`vendor-${userId}`);

      console.log(`vendor socket ${socket.id} joined vendor-room`);
    });
    socket.on('join-user-room', (userId: any) => {
      socket.join(`user-${userId}`);

      console.log(`user socket ${socket.id} joined user-room`);
    });

    socket.on('disconnect', reason => {
      const rtcRoom = (socket as any).rtcRoom;
      if (rtcRoom) {
        socket.to(rtcRoom).emit('peer-left', { socketId: socket.id });
        console.log(`📡 Notified room ${rtcRoom} that socket ${socket.id} left`);
      }
      console.log(`❌ Socket ${socket.id} disconnected. Reason: ${reason}`);
    });

    socket.on('error', error => {
      console.error(`🔴 Socket ${socket.id} error:`, error);
    });
  });

  // Export io instance for use in other parts of the application
  (global as any).io = io;

  return io;
}
