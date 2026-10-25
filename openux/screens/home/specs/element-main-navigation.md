---
element-id: main-navigation
---

# Main navigation behavior

## Purpose

Provide access to the application's primary sections and identify the section currently being viewed.

## Requirements

### Requirement: Group dashboard destinations
The navigation SHALL show Overview, Transactions, Accounts, and Payments under Workspace, followed by Settings and Help center under Manage.

#### Scenario: The dashboard navigation is displayed
- **WHEN** the dashboard navigation is rendered
- **THEN** the Workspace and Manage groups and their destinations appear in that order.

### Requirement: Navigate to the selected section
Selecting a navigation destination SHALL display its corresponding application screen.

#### Scenario: The user selects Overview
- **WHEN** the user selects Overview
- **THEN** the application displays the Home screen's account overview.

#### Scenario: The user selects Transactions
- **WHEN** the user selects Transactions
- **THEN** the application displays the Transactions screen.

#### Scenario: The user selects Accounts
- **WHEN** the user selects Accounts
- **THEN** the application displays the Accounts screen.

#### Scenario: The user selects Payments
- **WHEN** the user selects Payments
- **THEN** the application displays the Payments screen.

#### Scenario: The user selects Settings
- **WHEN** the user selects Settings
- **THEN** the application displays the Settings screen.

#### Scenario: The user selects Help center
- **WHEN** the user selects Help center
- **THEN** the application displays the Help center screen.

### Requirement: Identify the current destination
The navigation SHALL visually distinguish the destination matching the currently displayed screen as active.

#### Scenario: A destination screen is displayed
- **WHEN** the application displays a destination screen
- **THEN** its corresponding navigation item uses the active appearance and all other items use the inactive appearance.

### Requirement: Show the Payments count
The Payments destination SHALL display the count 3.

#### Scenario: The dashboard navigation is displayed
- **WHEN** the Payments destination is shown
- **THEN** its count indicator displays 3.

### Requirement: Adapt to narrow screens
At viewport widths of 760 pixels or less, the navigation SHALL hide its group labels and present its items in a horizontally scrollable row.

#### Scenario: The dashboard is viewed on a narrow screen
- **WHEN** the viewport width is 760 pixels or less
- **THEN** the group labels are hidden and navigation items remain on one horizontally scrollable row.
