import { registerRootComponent } from "expo";
import { randomUUID } from "expo-crypto";

import { defineRouteLocationTask } from "./src/location/expo-location-tracker";
import { Root, deviceOfflineStore } from "./src/Root";

// Antes de cualquier pantalla: Android despierta la tarea de la ubicación
// también con la app cerrada, y tiene que encontrarla definida.
defineRouteLocationTask(deviceOfflineStore, randomUUID);

registerRootComponent(Root);
