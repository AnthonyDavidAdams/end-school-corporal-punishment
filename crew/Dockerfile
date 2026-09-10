# Runs the End School Corporal Punishment crew on Ground Crew. Build from the repository root:
#   docker build -f crew/Dockerfile -t escp-crew .
# Railway: set RAILWAY_DOCKERFILE_PATH=crew/Dockerfile, mount a volume at /state, set ESCP_MAINTAINER_TOKEN.
FROM node:22-alpine
WORKDIR /app
RUN npm install --omit=dev https://github.com/AnthonyDavidAdams/groundcrew/archive/refs/heads/main.tar.gz
# The crew directory: crew.json, values, tasks and finding schemas from crew/, everything else from the campaign.
COPY crew/crew.json crew/values.md /crew/
COPY crew/tasks /crew/tasks
COPY crew/schemas /crew/schemas
COPY tasks/README.md /crew/tasks/README.md
COPY facts /crew/facts
COPY AGENTS.md CODE_OF_CONDUCT.md /crew/
COPY templates /crew/templates
COPY skills /crew/skills
COPY data/schema /crew/data/schema
COPY data/states /crew/data/states
COPY data/districts /crew/data/districts
COPY data/crdc /crew/data/crdc
ENV NODE_ENV=production PORT=3000 GROUNDCREW_CREW=/crew GROUNDCREW_STATE=/state/state.json
RUN mkdir -p /state
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/@earthpilot/groundcrew/bin/groundcrew.mjs serve /crew --http --port ${PORT}"]
