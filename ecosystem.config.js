module.exports = {
  apps: [
    {
      name: "qaramurt-taxi",
      script: "server.js",
      instances: 1, // Since we use websockets natively without redis scaling sometimes, stick to 1 instance. If you have Redis properly set up in production, you can set to "max"
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
