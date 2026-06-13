#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ---------------- WIFI ----------------
const char* ssid = "Parami";
const char* password = "";

// ---------------- SERVER ----------------
const char* serverUrl = "http://parami.reviewmate.live:8000/api/data/non-moss";

// ---------------- PINS ----------------
#define DHT_PIN 4
#define DHT_TYPE DHT22
#define ONE_WIRE_BUS 14

// ---------------- OBJECTS ----------------
DHT dht(DHT_PIN, DHT_TYPE);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature ds18b20(&oneWire);
Adafruit_MLX90614 mlx = Adafruit_MLX90614();

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);

  dht.begin();
  ds18b20.begin();

  Wire.begin(21, 22);
  mlx.begin();

  // 🔴 Keep WiFi OFF initially
  WiFi.mode(WIFI_OFF);
}

// ---------------- LOOP ----------------
void loop() {

  float airTemp = NAN;
  float airHumidity = NAN;
  float wallTemp = NAN;
  float surfaceTemp = NAN;

  // -------- READ DHT (ONLY THIS SENSOR ACTIVE) --------
  Serial.println("Reading DHT...");
  delay(2000); // stabilize
  airTemp = dht.readTemperature();
  airHumidity = dht.readHumidity();

  // -------- READ DS18B20 --------
  Serial.println("Reading DS18B20...");
  ds18b20.requestTemperatures();
  delay(750); // conversion time
  wallTemp = ds18b20.getTempCByIndex(0);

  // -------- READ MLX90614 --------
  Serial.println("Reading MLX90614...");
  delay(500);
  surfaceTemp = mlx.readObjectTempC();

  // -------- VALIDATION --------
  if (isnan(airTemp) || isnan(airHumidity) || wallTemp == -127) {
    Serial.println("Sensor error! Skipping...");
    delay(5000);
    return;
  }

  // -------- CREATE JSON --------
  String jsonData = "{";
  jsonData += "\"node\":\"non_moss\",";
  jsonData += "\"nonMossSurfaceTemp\":" + String(surfaceTemp, 2) + ",";
  jsonData += "\"nearNonMossTemp\":" + String(airTemp, 2) + ",";
  jsonData += "\"nearNonMossHumidity\":" + String(airHumidity, 2) + ",";
  jsonData += "\"wallTemp\":" + String(wallTemp, 2) + ",";
  jsonData += "\"timestamp\":\"" + getISOTime() + "\"";
  jsonData += "}";

  Serial.println("Prepared Data:");
  Serial.println(jsonData);

  // -------- CONNECT WIFI ONLY NOW --------
  Serial.println("Connecting WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");

    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    int httpResponseCode = http.POST(jsonData);

    Serial.print("Response: ");
    Serial.println(httpResponseCode);

    http.end();

    // 🔴 DISCONNECT WIFI AFTER SENDING
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.println("WiFi OFF");
  } else {
    Serial.println("\nWiFi Failed!");
  }

  // -------- SLEEP / DELAY --------
  Serial.println("Cycle complete. Sleeping...");
  delay(60000); // 1 min (can replace with deep sleep)
}

// ---------------- TIME FUNCTION ----------------
String getISOTime() {
  return "2026-04-09T00:00:00Z";
}