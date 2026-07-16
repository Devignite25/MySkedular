# Spredsheep Scheduler 📅⏰

Spredsheep is a sleek, polished, and production-ready **Employee Scheduling Progressive Web Application (PWA)** built for small, hourly teams. It features a robust Supabase backend, real-time schedule publishers, employee-facing dashboards, legal shift acknowledgments, and automated deployment configurations.

---

## 🚀 Key Product Features

### 1. Manager Control Panel
* **Weekly Scheduler Grid**: Visual weekly grid allowing managers to assign, edit, and delete shifts.
* **Labor Analytics**: Dynamic calculations showing active headcount, total scheduled hours, and unique assignments.
* **Safe Employee Invitations**: Invite team members securely via email and password using a PostgreSQL Database RPC (ensuring security role keys remain hidden from the client).
* **Schedule Templates**: Instantly copy shifts from the previous week with a single click.
* **Schedule Publisher**: Validate weekly hours (with blocker rules) and publish schedules instantly.
* **Acknowledgment Monitor**: Audit employee acknowledgments in real-time.

### 2. Employee Dashboard
* **Home Feed**: Welcoming view showing today's shift, tomorrow's/next shift, total weekly scheduled hours, and offline status alerts.
* **Personal Shifts**: View personal shifts for the active published week.
* **Team Viewer**: Safe directory of scheduled shifts across the team (masking emails and contact info).
* **Availability Preferences**: Define daily working hours and toggle available/unavailable days.
* **Schedule Acknowledgment**: Electronically sign off to acknowledge new schedules.

---

## 🛠 Tech Stack

* **Frontend**: React 19, TypeScript 6, Vite 8, Tailwind CSS v4
* **Database & Auth**: Supabase PostgreSQL, Supabase Auth, Row Level Security (RLS)
* **PWA & Cache**: `vite-plugin-pwa`, Workbox, responsive bottom-nav bar
* **CI/CD**: GitHub Actions deployment pipeline for GitHub Pages

---

## 📁 Repository Structure

```
├── .github/workflows/deploy-pages.yml  # Pages deployment workflow
├── supabase/
│   ├── migrations/
│   │   └── 20260716000000_init_schema.sql # Database schema, triggers & RPCs
│   └── seed.sql                           # Seed database records
├── src/
│   ├── features/
│   │   ├── auth/         # Login, Password Reset, Auth Context, Route Guards
│   │   ├── manager/      # Scheduler, Invites, Stats, Manager tabs
│   │   └── employee/     # Welcome card, Shift viewer, Availabilities, bottom-nav
│   ├── lib/              # Supabase Client configuration
│   ├── utils/            # Scheduling validation rules & date arithmetic
│   ├── types/            # TypeScript interfaces
│   ├── index.css         # Tailwind directives & glassmorphism theme styling
│   └── App.tsx           # Route layout and Guard assignments
```

---

## 📦 Database Schema & RLS Policies

All access is restricted using **Row Level Security (RLS)** in PostgreSQL. 

| Table Name | Description | RLS Policy Summary |
| :--- | :--- | :--- |
| `profiles` | User accounts containing `full_name`, `role`, and `active` status. | Anyone can read active profiles. Users can update their own names. Managers can write/edit all. |
| `employee_availability` | Employee weekly hour preferences per day (0-6). | Employees can read and edit their own. Managers can read all. |
| `schedule_weeks` | Schedule bounds (`week_start`) and state (`draft` vs `published`). | Employees can read only published weeks. Managers can read/write all. |
| `shifts` | Daily scheduled work shifts. | Employees can read published shifts. Managers can write/edit all. |
| `schedule_acknowledgments` | Logged confirmations of weekly published schedules. | Users can insert/read their own. Managers can read all. |

---

## ⚙️ Local Development Setup

### 1. Clone the repository and install dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory (based on `.env.example`):
```env
VITE_SUPABASE_URL=https://your-supabase-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

### 3. Apply Schema & Seed Database
Import the schema and seed data to your Supabase project:
1. Copy the SQL from `supabase/migrations/20260716000000_init_schema.sql` and run it inside the Supabase SQL Editor.
2. Copy the SQL from `supabase/seed.sql` and run it in the SQL Editor to populate sample employees, draft/published schedules, and availability rules.

### 4. Run Locally
```bash
npm run dev
```

### 5. Run Unit Tests
```bash
npm test
```

---

## 🐳 PWA & Offline Support

The application is configured to run as a **Progressive Web Application (PWA)**:
* Uses `vite-plugin-pwa` with `generateSW` to automatically cache scripts, styles, layout HTML, and static assets.
* Dynamically detects offline status and displays a visual banner informing users that the app is running in read-only offline mode.
* Excludes Supabase API queries from routing cache (allowing correct online state checking).

---

## 🚀 GitHub Pages Deployment

The pipeline is pre-configured via `.github/workflows/deploy-pages.yml`. When you push to the `main` branch:
1. GitHub Actions will install dependencies and compile the production bundle.
2. It will build relative pathing into PWA assets (`base: './'`).
3. It will deploy the compiled `dist/` output directory directly to GitHub Pages.

> [!NOTE]
> Make sure to configure the secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your GitHub repository setting secrets panel (`Settings` -> `Secrets and variables` -> `Actions`) for automated builds.

 
