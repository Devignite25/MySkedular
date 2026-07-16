# Spredsheep Scheduler 📅⏰

Spredsheep is a sleek, polished, and production-ready **Employee Scheduling Progressive Web Application (PWA)** for any company with hourly teams. An admin sets up departments and managers; managers schedule their departments; employees see their shifts, set availability, and request time off. Built on a Supabase backend with department-scoped Row Level Security.

**Roles:** the first account to sign up becomes the **admin**. Admins create **managers** (each can run one or more departments) and **employees** (each belongs to one department).

---

## 🚀 Key Product Features

### 0. Admin Console
* **Departments**: Create, deactivate, or delete departments — each with its own schedules and staff.
* **Staff Management**: Create manager and employee accounts, assign managers to any set of departments, move employees between departments, deactivate or delete accounts.
* **App Settings**: Organization name (shown across the app) and the weekly hours cap enforced by scheduling validation.

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
* **Time Off Requests**: Request days off with an optional reason; track pending/approved/denied status; cancel pending requests. Managers review requests and keep the final say — scheduling over approved time off raises a warning, not a block.
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
│   │   ├── 20260716000000_init_schema.sql # Database schema, triggers & RPCs
│   │   ├── 20260717000000_fix_rpc_rls_and_overnight.sql # RPC/RLS fixes, overnight shifts
│   │   ├── 20260717000001_harden_function_grants.sql # Function grant hardening
│   │   ├── 20260717000002_delete_employee_rpc.sql # Staff deletion RPC
│   │   └── 20260718000000_departments_admin_timeoff.sql # Admin role, departments, time off, settings
│   └── seed.sql                           # Seed database records
├── src/
│   ├── features/
│   │   ├── auth/         # Login, Password Reset, Auth Context, Route Guards
│   │   ├── admin/        # Admin console: departments, staff, app settings
│   │   ├── manager/      # Scheduler, Invites, Time off review, Manager tabs
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
| `app_settings` | Singleton: `org_name`, `weekly_hours_cap`. | Anyone signed in can read; only admins can update. |
| `departments` | Departments, each with its own schedules and staff. | Anyone signed in can read; only admins can manage. |
| `profiles` | User accounts: `full_name`, `role` (`admin`/`manager`/`employee`), `active`, `department_id`. | Users read their own profile plus active department-mates; managers read staff of departments they manage; admins read all. A trigger blocks non-managers from changing `role`/`active`/`department_id`, and only admins may touch the admin role. |
| `manager_departments` | Which departments each manager runs (many-to-many). | Managers read their own assignments; admins manage all. |
| `employee_availability` | Employee weekly hour preferences per day (0-6). | Employees read/edit their own; managers of their department (and admins) can too. |
| `schedule_weeks` | Per-department schedule bounds (`week_start`) and state (`draft` vs `published`). | Employees read published weeks of their department. Managers manage weeks of departments they manage. |
| `shifts` | Daily scheduled work shifts. | Employees read published shifts of their department. Managers manage shifts of their departments. |
| `schedule_acknowledgments` | Logged confirmations of weekly published schedules. | Users insert/read their own. Managers read their departments'. |
| `time_off_requests` | Employee time-off requests with `pending`/`approved`/`denied` status. | Employees create/read/cancel their own pending requests. Managers of the employee's department review (approve/deny). |

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
1. Run each file in `supabase/migrations/` (in filename order) inside the Supabase SQL Editor.
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

 
