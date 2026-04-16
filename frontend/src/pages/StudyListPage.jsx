import { Navigate } from "react-router-dom";

// The viewer IS the main page — study list lives in the sidebar.
// This redirect keeps the routing clean if someone hits "/".
export default function StudyListPage() {
  return <Navigate to="/viewer/default" replace />;
}
