export const adminViewTitles = {
  overview: "Admin Dashboard",
  access_alerts: "Access alerts",
  users: "Users",
  online: "Online now",
  joined: "Joined this week",
  countries: "Countries",
  active: "Active users",
  expired: "Expired users",
  rooms: "Rooms",
  devices: "Devices",
  payments: "Pending payments",
  currency: "Currency",
  support: "Open support",
  closed_support: "Closed tickets",
  plans: "Plans",
};

export function adminViewFromHash(hash) {
  const view = hash.slice(1).replaceAll("-", "_");
  return Object.hasOwn(adminViewTitles, view) ? view : "overview";
}

export function navigateAdminView(browser, view) {
  const { location, history } = browser;
  const url = new URL(location.href);
  if (view === "overview") {
    if (history.state?.sayupAdminFromDashboard === true) {
      history.back();
      return null;
    }
    url.hash = "";
    history.replaceState(history.state, "", url);
  } else {
    const fromDashboard = adminViewFromHash(url.hash) === "overview";
    url.hash = view.replaceAll("_", "-");
    history.pushState({ ...history.state, sayupAdminFromDashboard: fromDashboard }, "", url);
  }
  return view;
}
