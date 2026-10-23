import { StyleSheet } from "react-native";

const PRIMARY = "#0369a1";

export const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#ffffff" },
  // La pantalla con la ruta: arranca arriba y se desplaza, la lista es larga.
  scrollScreen: { padding: 24, paddingTop: 48, backgroundColor: "#ffffff" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "700", color: "#0f172a", marginBottom: 4 },
  subtitle: { fontSize: 16, color: "#475569", marginBottom: 24 },
  label: { fontSize: 16, fontWeight: "600", color: "#0f172a", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 18,
    marginBottom: 16,
  },
  alert: { fontSize: 16, color: "#b91c1c", marginBottom: 16 },
  notice: { fontSize: 16, color: "#92400e", marginBottom: 16 },
  card: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  button: { backgroundColor: PRIMARY, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#ffffff", fontSize: 18, fontWeight: "600" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: { color: PRIMARY, fontSize: 18, fontWeight: "600" },
});
