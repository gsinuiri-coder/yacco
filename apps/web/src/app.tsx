import { Route, Routes } from "react-router";
import { AuthProvider } from "./auth/auth-provider";
import { CustomerCreatePage } from "./pages/customer-create-page";
import { CustomerEditPage } from "./pages/customer-edit-page";
import { CustomersPage } from "./pages/customers-page";
import { DashboardPage } from "./pages/dashboard-page";
import { LoginPage } from "./pages/login-page";
import { OrderCreatePage } from "./pages/order-create-page";
import { OrdersPage } from "./pages/orders-page";
import { ProtectedRoute } from "./routes/protected-route";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/new" element={<CustomerCreatePage />} />
          <Route path="/customers/:customerId" element={<CustomerEditPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/new" element={<OrderCreatePage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
