import { WebSocketServer } from './web-socket.js'

// Create and start the WebSocket server
const wsServer = new WebSocketServer()

// WebSocket server is now running and ready to accept JWT-authenticated connections
setTimeout(() => {
  console.log('🚀 WebSocket server is ready at ws://localhost:4002/ws')
  console.log('🔐 Only valid JWT Bearer tokens will be accepted')
}, 1000)

// Handle graceful shutdown
process.on('SIGINT', () => {
  
  wsServer.cleanup()
  process.exit(0)
})

process.on('SIGTERM', () => {
  
  wsServer.cleanup()
  process.exit(0)
})

