# SafeRoute 🛡️

**AI-assisted pedestrian navigation focused on safer, illuminated, and populated journeys.**

SafeRoute is an AI-powered hackathon project built to solve the "last-mile" safety problem. While standard navigation applications prioritize the shortest physical distance—often routing pedestrians through unlit, isolated alleys at night—SafeRoute utilizes spatial databases and AI to evaluate environmental safety conditions, offering users secure alternatives.

> **Important Disclaimer:** SafeRoute is an experimental prototype built for a hackathon. It is not a guarantee of personal safety. Its assessments depend on the accuracy, freshness, and coverage of community data and open-source maps. Users must always apply their own judgment and contact local emergency services in dangerous situations.

## Table of Contents
- [Features](#features)
- [How Route Evaluation Works](#how-route-evaluation-works)
- [Technology Stack](#technology-stack)
- [System Architecture](#system-architecture)
- [Local Development Setup](#local-development-setup)
- [API Overview](#api-overview)
- [AWS & DevOps Infrastructure](#aws--devops-infrastructure)
- [Current Limitations & Future Scope](#current-limitations--future-scope)

## Features

- **Multi-Path Routing Engine:** Dynamically contrasts the "Fastest" route (shortest distance) with "Safest" and "Moderate" alternatives based on community safety data and lighting.
- **Live Community Hazard Reporting:** Users can drop pins to flag broken streetlights, isolated blindspots, or active hazards, instantly rendering as avoidance polygons (red zones) on the map.
- **Dynamic Context Generation:** Google Gemini AI processes route coordinates and hazard intersections to generate plain-text explanations of *why* a route received a specific safety score.
- **Interactive Navigation UI:** A React and Leaflet-based map featuring simulated turn-by-turn tracking and a one-tap GPS recentering control.
- **SOS Emergency Broadcast:** An integrated emergency interface designed to broadcast live user telemetry and coordinates during critical situations.

## How Route Evaluation Works

SafeRoute abandons standard A* shortest-path algorithms in favor of a safety-weighted spatial evaluation:

1. **Coordinate Submission:** The frontend sends origin and destination coordinates to the backend.
2. **Spatial Intersections (PostGIS):** The backend generates candidate routes and queries PostgreSQL/PostGIS using `ST_Intersects` to check if the path crosses known hazard polygons (red zones) or passes through verified safe checkpoints (green nodes).
3. **Algorithmic Weighting:** The system balances physical distance with safety. It actively forces detours around flagged hazard zones, calculating the trade-off of walking a longer distance to remain in well-lit corridors.
4. **AI Scoring & Context:** The raw routing geometry and hazard proximity data are passed to the Gemini API. Gemini evaluates the data and returns a normalized Safety Score (0-100) alongside contextual guidance (e.g., *"This 2.25 km route bypasses unlit residential stretches..."*).

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React.js, Leaflet | Dynamic map rendering, UI components, and state management. |
| **Backend** | Python, FastAPI | High-performance asynchronous API endpoints and routing logic. |
| **Database** | PostgreSQL, PostGIS | Persisting geolocated hazard reports and executing complex spatial queries. |
| **AI Integration** | Google Gemini API | Generating real-time safety scores and contextual route explanations. |
| **Local Dev** | Docker, Docker Compose | Containerized local environment for seamless frontend/backend/DB orchestration. |
| **Cloud Infra** | AWS Elastic Beanstalk, Amazon RDS | Managed load-balanced hosting and database provisioning. |
| **CI/CD** | GitHub Actions | Automated build and deployment pipelines. |

## System Architecture

```text
                 ┌──────────────────────────────┐
                 │       React + Leaflet        │
                 │ Map · Routes · Reports · SOS │
                 └──────────────┬───────────────┘
                                │ REST API (JSON)
                 ┌──────────────▼───────────────┐
                 │         FastAPI App          │
                 │ Route Logic · AI Integration │
                 └───────┬─────────┬────────────┘
                         │         │
              ┌──────────▼───┐  ┌──▼────────────────┐
              │ Amazon RDS   │  │ External APIs     │
              │ (PostgreSQL) │  │ Google Gemini API,│
              │ with PostGIS │  │ OSM/Routing data  │
              └──────────────┘  └───────────────────┘
```

## Local Development Setup

The project uses Docker Compose to ensure a consistent development environment across all machines without requiring manual database installations.

### Prerequisites
- Git
- Docker Desktop / Docker Engine
- Google Gemini API Key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/saferoute.git
   cd saferoute
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory (do not commit this file). Add your database credentials and API keys:
   ```env
   DATABASE_URL=postgresql://user:password@db:5432/saferoutedb
   GEMINI_API_KEY=your_api_key_here
   ```

3. **Spin up the containers:**
   ```bash
   docker-compose up --build
   ```

4. **Access the application:**
   - Frontend: `http://localhost:3000` (or as defined in your compose file)
   - Backend API Docs: `http://localhost:8000/docs`

## API Overview

The FastAPI backend automatically generates interactive Swagger documentation available at `/docs`. Core endpoints include:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | LB Health check endpoint to verify API uptime. |
| `GET` | `/api/reports` | Fetches active community hazard reports within a bounding box. |
| `POST` | `/api/reports` | Submits a new geolocated hazard report to PostGIS. |
| `POST` | `/api/plan-routes` | Core engine: Evaluates origin/destination and returns Fastest, Safest, and Moderate route geometries with Gemini safety scores. |

## AWS & DevOps Infrastructure

SafeRoute is engineered for high availability and zero-downtime deployments.

- **Compute:** Deployed to **AWS Elastic Beanstalk** configured as a **Load-balanced** environment (Minimum 1 instance, Maximum 3 instances) to handle traffic spikes.
- **Database:** Hosted on **Amazon RDS** (PostgreSQL) to decouple state from the compute instances.
- **CI/CD Pipeline:** **GitHub Actions** automatically lints, builds the Docker image, and triggers the Beanstalk deployment on every push to the `main` branch.
- **Deployment Strategy:** Configured to use **Rolling with additional batch** deployments. AWS provisions a temporary secondary EC2 instance to route traffic during updates, ensuring the live application never drops connections during a GitHub Action push.

## Current Limitations & Future Scope

As a hackathon prototype, the routing engine currently exhibits some edge-case limitations that are slated for future improvement:

- **Algorithmic Pathing Improvements:** The current "Safest" routing logic occasionally forces unnecessary "U-turns" or backtracking to hit verified safe zones (checkpoint farming). Future updates will implement an Ellipse/Triangle Inequality spatial filter to ensure safe waypoints only trigger if they lie in the general forward direction of travel.
- **Hazard Repulsion:** Implementing dynamic vector shifting to push route generation 250m perpendicular to red hazard zones, preventing routes from clipping the edges of reported danger areas.
- **Time-Decay Reporting:** Adding logic to degrade the severity of community hazard reports over time unless verified by multiple users.