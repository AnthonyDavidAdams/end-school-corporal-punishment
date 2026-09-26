# Runs the End School Corporal Punishment crew on Ground Crew. Build from the repository root:
#   docker build -f crew/Dockerfile -t escp-crew .
# Railway: set RAILWAY_DOCKERFILE_PATH=crew/Dockerfile, mount a volume at /state, set ESCP_MAINTAINER_TOKEN.
FROM node:22-alpine
# Fonts. resvg renders the badge, and with no fonts installed it silently draws every shape and none of
# the text -- a valid PNG of an empty circle. Alpine ships none, so they have to be asked for.
RUN apk add --no-cache font-dejavu fontconfig && fc-cache -f
WORKDIR /app
RUN npm install --omit=dev https://github.com/AnthonyDavidAdams/groundcrew/archive/ffed3a5b7d899ba8f6215bada076165120ef9b66.tar.gz
# The crew directory: crew.json, values, tasks and finding schemas from crew/, everything else from the campaign.
COPY crew/crew.json crew/values.md /crew/
COPY crew/tasks /crew/tasks
COPY crew/schemas /crew/schemas
COPY crew/tools.mjs /crew/tools.mjs
COPY tasks/README.md /crew/tasks/README.md
COPY facts /crew/facts
COPY AGENTS.md CODE_OF_CONDUCT.md /crew/
COPY templates /crew/templates
COPY skills /crew/skills
COPY data/schema /crew/data/schema
COPY data/states /crew/data/states
COPY data/districts /crew/data/districts
COPY data/crdc /crew/data/crdc
# The ordered worklist, so get_worklist can turn an assigned scope into the actual districts to read.
COPY site/data/worklist.json /crew/data/worklist.json
# Per-district residue: what the Mothership read, what is walled, what is asked of a contributor.
COPY data/handbooks/residue.json /crew/data/residue.json
ENV NODE_ENV=production PORT=3000 GROUNDCREW_CREW=/crew GROUNDCREW_STATE=/state/state.json GROUNDCREW_ISSUES_DIR=/state/issues GROUNDCREW_DOCS_DIR=/state/documents
RUN mkdir -p /state
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/@earthpilot/groundcrew/bin/groundcrew.mjs serve /crew --http --port ${PORT}"]
