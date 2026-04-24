const fs = require('fs');
let code = fs.readFileSync('driver-app/app/index.tsx', 'utf8');

// 1. Add refs
code = code.replace(
  '  const handledOrderAlertsRef = useRef<Map<number, number>>(new Map());',
  '  const handledOrderAlertsRef = useRef<Map<number, number>>(new Map());\n  // Guard against concurrent loadDashboard calls\n  const loadingDashboardRef = useRef(false);\n  const lastDashboardLoadRef = useRef(0);'
);

// 2. Wrap loadDashboard with throttle/guard
const oldLoadDashboardStart = '  const loadDashboard = useCallback(async () => {';
const newLoadDashboardStart = `  const loadDashboard = useCallback(async () => {
    if (loadingDashboardRef.current) return;
    const now = Date.now();
    if (now - lastDashboardLoadRef.current < 10000) return;
    
    loadingDashboardRef.current = true;
    lastDashboardLoadRef.current = now;
    
    try {`;

code = code.replace(oldLoadDashboardStart, newLoadDashboardStart);

code = code.replace(/\s+realtimeDriverRef\.current = null;\r?\n\s+\}\r?\n\s+\}, \[/, 
  '\n      realtimeDriverRef.current = null;\n    }\n    } finally {\n      loadingDashboardRef.current = false;\n    }\n  }, [');

// 3. Fix interval
code = code.replace(
  /const interval = setInterval\(\(\) => \{\r?\n\s+if \(AppState\.currentState === "active"\) \{\r?\n\s+loadDashboard\(\);\r?\n\s+\} else \{/,
  `const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        const sock = getSocket();
        if (!sock || !sock.connected) {
          loadDashboard();
        }
      } else {`
);

// Change 15000 to 60000
code = code.replace('}, 15000);', '}, 60000);');

fs.writeFileSync('driver-app/app/index.tsx', code);
console.log('Patched index.tsx successfully.');
