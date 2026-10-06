/**
 * @file dashboard.ts
 * @description Contents of the meetings dashboard, an Obsidian Bases file
 * listing every note the plugin manages.
 */

export const DASHBOARD_FILENAME = "Meetings.base";

export const DASHBOARD_CONTENT = `filters:
  and:
    - 'file.hasProperty("calendar_event_id")'
views:
  - type: table
    name: Next 7 days
    filters:
      and:
        - 'note.start >= today()'
        - 'note.start < today() + "7d"'
    order:
      - file.name
      - note.start
      - note.location
      - note.attendees
      - note.calendar
    groupBy:
      property: note.date
      direction: ASC
  - type: table
    name: Last 7 days
    filters:
      and:
        - 'note.start < now()'
        - 'note.start >= today() - "7d"'
    order:
      - file.name
      - note.start
      - note.attendees
      - note.calendar
    groupBy:
      property: note.date
      direction: DESC
  - type: table
    name: All meetings
    order:
      - file.name
      - note.start
      - note.organizer
      - note.attendees
      - note.calendar
      - note.status
    groupBy:
      property: note.date
      direction: DESC
`;
