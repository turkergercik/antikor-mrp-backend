const { Server } = require('socket.io');

let io;

module.exports = {
  initialize(strapi) {
    const server = strapi.server.httpServer;
    
    io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });

    strapi.io = io;
    console.log('Socket.IO initialized');
  },

  emitOrderCreated(order) {
    if (io) {
      io.emit('order:created', order);
    }
  },

  emitOrderUpdated(order) {
    if (io) {
      io.emit('order:updated', order);
    }
  },

  emitOrderDeleted(orderId) {
    if (io) {
      io.emit('order:deleted', orderId);
    }
  }
};
