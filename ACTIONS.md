# Explanation of the Example `actions.json`

This `actions.json` file defines a series of actions that the crawler can perform on web pages based on certain conditions. Each object in the array represents a set of actions to be executed.

## Action Structure

- **`if`**: Specifies a CSS selector. If an element matching this selector is found on the page, the actions in the `then` array will be executed.
- **`then`**: Contains an array of actions to be performed. Each action is an object with the following properties:
  - **`action`**: The type of action to perform. Possible values include:
    - **`type`**: Type text into an input field.
    - **`click`**: Click on an element.
    - **`eval`**: Set a value to an element.
    - **`hold`**: Stop the crawl if the URL matches.
  - **`selector`**: A CSS selector to identify the element to interact with.
  - **`value`**: The value to type into an input field or set to an element.
  - **`on`**: (For `click` and `hold` actions) A boolean indicating whether the action should be performed. `true` means perform the action, `false` means don't.
  - **`url`**: (For `hold` actions) The URL to match.

## Breakdown of the Actions

### Login Form
```json
{
  "if": "#login-form",
  "then": [
    { "action": "type", "selector": "input[name='username']", "value": "your_username" },
    { "action": "type", "selector": "input[name='password']", "value": "your_password" },
    { "action": "click", "selector": "button[type='submit']" }
  ]
}
```
- If a login form with the ID `login-form` is found:
  - Type `your_username` into the username field.
  - Type `your_password` into the password field.
  - Click the submit button.

### Two-Factor Authentication
```json
{
  "if": ".two-factor-auth",
  "then": [
    { "action": "type", "selector": "input[name='code']", "value": "123456" },
    { "action": "click", "selector": "button[type='submit']" }
  ]
}
```
- If a two-factor authentication form is found:
  - Type `123456` into the authentication code field.
  - Click the submit button.

### Search Form
```json
{
  "if": "#search-form",
  "then": [
    { "action": "type", "selector": "input[name='q']", "value": "search term" },
    { "action": "click", "selector": "button[type='submit']" }
  ]
}
```
- If a search form with the ID `search-form` is found:
  - Type `search term` into the search input field.
  - Click the submit button.

### Cookie Consent
```json
{
  "if": ".cookie-consent",
  "then": [
    { "action": "click", "selector": "button.accept-cookies" }
  ]
}
```
- If a cookie consent banner is found:
  - Click the "accept cookies" button.

### Profile Page
```json
{
  "if": ".profile-page",
  "then": [
    { "action": "eval", "selector": "#user-id", "value": "1234" },
    { "action": "hold", "url": "https://www.example.com/profile" }
  ]
}
```
- If a profile page is found:
  - Set the value `1234` to the element with the ID `user-id`.
  - Stop the crawl if the URL is `https://www.example.com/profile`.

## How to Use

1. Save this JSON content to a file named `actions.json` (or any name you prefer).
2. Run the crawler with the `--actions-file` option, pointing to your `actions.json` file:
   ```sh
   node crawler.js --actions-file actions.json
   ```

This allows the crawler to automatically interact with web pages based on the defined conditions.