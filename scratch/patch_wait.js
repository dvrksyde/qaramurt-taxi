const fs = require('fs');

let code = fs.readFileSync('driver-app/app/index.tsx', 'utf8');

const targetToRemove = `<TouchableOpacity
                  style={{
                    height: 52,
                    borderRadius: 14,
                    marginBottom: 12,
                    backgroundColor: activeOrder.isWaiting ? "#FFD000" : "#202020",
                    borderWidth: 1,
                    borderColor: activeOrder.isWaiting ? "#FFD000" : "#3a3a3a",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    opacity: loading ? 0.6 : 1,
                  }}
                  onPress={() => toggleTripWaiting(activeOrder.isWaiting ? "stop" : "start")}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={activeOrder.isWaiting ? "play" : "pause"}
                    size={18}
                    color={activeOrder.isWaiting ? "#0a0a0a" : "#fff"}
                  />
                  <Text style={{ color: activeOrder.isWaiting ? "#0a0a0a" : "#fff", fontSize: 14, fontWeight: "800" }}>
                    {activeOrder.isWaiting
                      ? \`Продолжить поездку (\${tripWaitingFee} ₸)\`
                      : "Начать ожидание · 20 ₸/мин"}
                  </Text>
                </TouchableOpacity>`;

// Notice that the file has cyrillic text encoded with some strange characters (e.g. РџСЂРѕРґРѕР»Р¶РёС‚СЊ).
// We should use a regex to be safe.
const removeRegex = /<TouchableOpacity[\s\S]*?onPress=\{\(\) => toggleTripWaiting\(activeOrder\.isWaiting \? "stop" : "start"\)\}[\s\S]*?<\/TouchableOpacity>/;

code = code.replace(removeRegex, "");

const insertTarget = `          </View>
        </View>
      );
    }

    return (
      <View style={styles.pageBlock}>`;

const replacement = `          </View>

          {/* Floating Wait Button */}
          {activeOrder.status === "in_progress" && (
            <TouchableOpacity
              style={{
                position: "absolute",
                right: 20,
                bottom: "15%",
                width: 60,
                height: 60,
                borderRadius: 30,
                backgroundColor: activeOrder.isWaiting ? "#FFD000" : "#202020",
                borderWidth: 2,
                borderColor: activeOrder.isWaiting ? "#FFD000" : "#3a3a3a",
                alignItems: "center",
                justifyContent: "center",
                elevation: 10,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.5,
                shadowRadius: 5,
                zIndex: 9999,
              }}
              onPress={() => toggleTripWaiting(activeOrder.isWaiting ? "stop" : "start")}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Ionicons
                name={activeOrder.isWaiting ? "play" : "pause"}
                size={28}
                color={activeOrder.isWaiting ? "#0a0a0a" : "#FFD000"}
              />
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return (
      <View style={styles.pageBlock}>`;

code = code.replace(insertTarget, replacement);

fs.writeFileSync('driver-app/app/index.tsx', code);
console.log('Patched waiting button to FAB');
