#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ---------------- WIFI ----------------
const char* ssid = "Keshaka";
const char* password = "Qwer3552";

// ---------------- SERVER ----------------
const char* serverUrl = "http://54.169.243.167:8000/api/data/moss";

// ---------------- PINS ----------------
#define DHT_OUTDOOR_PIN 14
#define DHT_MOSS_PIN 27
#define DHT_TYPE DHT22
#define ONE_WIRE_BUS 18

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

  // Connect WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi connected!");
}

// ---------------- LOOP ----------------
void loop() {

  // -------- READ SENSORS --------
  float outdoorTemp = dhtOutdoor.readTemperature();
  float outdoorHumidity = dhtOutdoor.readHumidity();

  float mossTemp = dhtMoss.readTemperature();
  float mossHumidity = dhtMoss.readHumidity();

  ds18b20.requestTemperatures();
  float wallTemp = ds18b20.getTempCByIndex(0);

  float mossSurfaceTemp = mlx.readObjectTempC();

  // -------- VALIDATION --------
  if (isnan(outdoorTemp) || isnan(outdoorHumidity) ||
      isnan(mossTemp) || isnan(mossHumidity) ||
      wallTemp == -127) {

    Serial.println("Sensor error! Skipping...");
    delay(5000);
    return;
  }

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

  Serial.println("Sending Data:");
  Serial.println(jsonData);

  // -------- SEND DATA --------
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    int httpResponseCode = http.POST(jsonData);

    Serial.print("Response: ");
    Serial.println(httpResponseCode);

    http.end();
  } else {
    Serial.println("WiFi Disconnected!");
  }

  // -------- DELAY 1 MIN --------
  delay(3*60000);
}

// ---------------- TIME FUNCTION ----------------
String getISOTime() {
  // Simple placeholder time (you can upgrade to NTP later)
  return "2026-04-09T00:00:00Z";
}