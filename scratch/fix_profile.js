const fs = require('fs');
const path = 'driver-app/components/DriverProfilePanel.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldLine = '<Text style={styles.summaryMeta}>Баланс: {Number(profile?.balance || 0).toLocaleString()} ₸</Text>';
const newLine = `<Text style={[styles.summaryMeta, Number(profile?.balance || 0) < 30 && { color: '#ef4444' }]}>
            Баланс: {Number(profile?.balance || 0).toLocaleString()} ₸
          </Text>
          {Number(profile?.balance || 0) < 30 && (
            <Text style={{ color: '#ef4444', fontSize: 13, marginTop: 4, fontWeight: 'bold' }}>
              ⚠️ Недостаточный баланс (минимум 30 ₸)
            </Text>
          )}`;

content = content.replace(oldLine, newLine);
fs.writeFileSync(path, content, 'utf8');
console.log('Replaced in DriverProfilePanel');
