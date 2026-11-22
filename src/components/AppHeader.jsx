import { NavLink, Link } from "react-router-dom";
import "./AppHeader.css";

function AppHeader({ tone = "light" }) {
  return (
    <header className={`arc-header arc-header-${tone}`}>
      <Link className="arc-brand" to="/">
        <span>✦</span>
        WINTER ARC
      </Link>

      <nav className="arc-nav" aria-label="App">
        <NavLink to="/today">Today</NavLink>
        <NavLink to="/journey">Journey</NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/settings/notifications">Reminders</NavLink>
      </nav>
    </header>
  );
}

export default AppHeader;
