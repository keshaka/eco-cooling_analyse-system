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
const char* serverUrl = "http://parami.reviewmate.live:8000/api/data/moss";

// ---------------- PINS ----------------
#define DHT_OUTDOOR_PIN 14
#define DHT_MOSS_PIN 18
#define DHT_TYPE DHT22
#define ONE_WIRE_BUS 27

// ---------------- OBJECTS ----------------
DHT dhtOutdoor(DHT_OUTDOOR_PIN, DHT_TYPE);
DHT dhtMoss(DHT_MOSS_PIN, DHT_TYPE);

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature ds18b20(&oneWire);

Adafruit_MLX90614 mlx = Adafruit_MLX90614();

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);

  dhtOutdoor.begin();
  dhtMoss.begin();
  ds18b20.begin();

  Wire.begin(21, 22);
  mlx.begin();

  // 🔴 Start with WiFi OFF
  WiFi.mode(WIFI_OFF);
}

// ---------------- LOOP ----------------
void loop() {

  float outdoorTemp = NAN;
  float outdoorHumidity = NAN;
  float mossTemp = NAN;
  float mossHumidity = NAN;
  float wallTemp = NAN;
  float mossSurfaceTemp = NAN;

  // -------- READ OUTDOOR DHT --------
  Serial.println("Reading Outdoor DHT...");
  delay(2000); // stabilize
  outdoorTemp = dhtOutdoor.readTemperature();
  outdoorHumidity = dhtOutdoor.readHumidity();

  // -------- READ MOSS DHT --------
  Serial.println("Reading Moss DHT...");
  delay(2000); // stabilize (important for second DHT)
  mossTemp = dhtMoss.readTemperature();
  mossHumidity = dhtMoss.readHumidity();

  // -------- READ DS18B20 --------
  Serial.println("Reading DS18B20...");
  ds18b20.requestTemperatures();
  delay(750);
  wallTemp = ds18b20.getTempCByIndex(0);

  // -------- READ MLX90614 --------
  Serial.println("Reading MLX90614...");
  delay(500);
  mossSurfaceTemp = mlx.readObjectTempC();



  // -------- CREATE JSON --------
  String jsonData = "{";
  jsonData += "\"node\":\"moss\",";
  jsonData += "\"outdoorTemp\":" + String(outdoorTemp, 2) + ",";
  jsonData += "\"outdoorHumidity\":" + String(outdoorHumidity, 2) + ",";
  jsonData += "\"mossSurfaceTemp\":" + String(mossSurfaceTemp, 2) + ",";
  jsonData += "\"nearMossTemp\":" + String(mossTemp, 2) + ",";
  jsonData += "\"nearMossHumidity\":" + String(mossHumidity, 2) + ",";
  jsonData += "\"wallTemp\":" + String(wallTemp, 2) + ",";
  jsonData += "\"timestamp\":\"" + getISOTime() + "\"";
  jsonData += "}";

  Serial.println("Prepared Data:");
  Serial.println(jsonData);

  // -------- CONNECT WIFI ONLY AFTER ALL READINGS --------
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

    // 🔴 TURN OFF WIFI AFTER SEND
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.println("WiFi OFF");
  } else {
    Serial.println("\nWiFi Failed!");
  }

  // -------- SLEEP / DELAY --------
  Serial.println("Cycle complete. Sleeping...");
  delay(60000); // replace with deep sleep if needed
}

// ---------------- TIME FUNCTION ----------------
String getISOTime() {
  return "2026-04-09T00:00:00Z";
}