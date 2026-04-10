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
const char* serverUrl = "http://54.169.243.167:8000/api/data/non-moss";

// ---------------- PINS ----------------
#define DHT_PIN 4
#define DHT_TYPE DHT22
#define ONE_WIRE_BUS 14  // DS18B20

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

  Wire.begin(21, 22); // SDA, SCL
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
  float airTemp = dht.readTemperature();
  float airHumidity = dht.readHumidity();

  ds18b20.requestTemperatures();
  float wallTemp = ds18b20.getTempCByIndex(0);

  float surfaceTemp = mlx.readObjectTempC();

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
  return "2026-04-09T00:00:00Z";
}