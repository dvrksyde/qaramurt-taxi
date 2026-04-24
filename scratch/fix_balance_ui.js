const fs = require('fs');
const path = 'driver-app/app/index.tsx';

let content = fs.readFileSync(path, 'utf8');

// Fix the stats row: add red border on balance card + low balance banner
const oldStatsRow = `        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>\u0420\u0432\u0430\u043b\u0430\u0420\u0420\u0421\u0421</Text>
            <Text style={styles.statValue}>{Number(profile.balance).toLocaleString()} \u0432\u201a\u0451</Text>
          </View>`;

// Let's find the actual text by searching for the ASCII parts
const statsRowStart = content.indexOf('<View style={styles.statsRow}>');
const centerAreaStart = content.indexOf('<View style={styles.centerArea}>');

if (statsRowStart === -1 || centerAreaStart === -1) {
  console.error('Could not find markers. statsRow:', statsRowStart, 'centerArea:', centerAreaStart);
  process.exit(1);
}

// Extract the old section
const oldSection = content.substring(statsRowStart, centerAreaStart);
console.log('Old section found, length:', oldSection.length);
console.log('Preview:', oldSection.substring(0, 200));

const newSection = `<View style={styles.statsRow}>
          <View style={[styles.statCard, Number(profile.balance) < MIN_DRIVER_BALANCE && { borderColor: "#ef4444", borderWidth: 1 }]}>
            <Text style={styles.statLabel}>\u0411\u0430\u043b\u0430\u043d\u0441</Text>
            <Text style={[styles.statValue, Number(profile.balance) < MIN_DRIVER_BALANCE && { color: "#ef4444" }]}>{Number(profile.balance).toLocaleString()} \u20b8</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>\u0420\u0435\u0439\u0442\u0438\u043d\u0433</Text>
            <Text style={styles.statValue}>#{Number(profile.rating || 0)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>\u0417\u0430\u043a\u0430\u0437\u043e\u0432</Text>
            <Text style={styles.statValue}>{Number(profile.ordersCount || 0)}</Text>
          </View>
        </View>

        {Number(profile.balance) < MIN_DRIVER_BALANCE && (
          <View style={styles.lowBalanceBanner}>
            <Ionicons name="warning" size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.lowBalanceBannerTitle}>\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u044b\u0439 \u0431\u0430\u043b\u0430\u043d\u0441!</Text>
              <Text style={styles.lowBalanceBannerText}>\u041c\u0438\u043d\u0438\u043c\u0443\u043c 30 \u20b8 \u0434\u043b\u044f \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0438\u044f \u0437\u0430\u043a\u0430\u0437\u043e\u0432. \u041f\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0441\u0447\u0435\u0442 \u0443 \u0434\u0438\u0441\u043f\u0435\u0442\u0447\u0435\u0440\u0430.</Text>
            </View>
          </View>
        )}

        `;

content = content.substring(0, statsRowStart) + newSection + content.substring(centerAreaStart);

fs.writeFileSync(path, content, 'utf8');
console.log('Done! Stats row replaced with balance warning UI.');
