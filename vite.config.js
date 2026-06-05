const { defineConfig, loadEnv } = require("vite");
const react = require("@vitejs/plugin-react");

module.exports = defineConfig(function ({ mode }) {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.PORT || process.env.PORT || 8787;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": "http://localhost:" + apiPort
      }
    }
  };
});
