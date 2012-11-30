# TestDrive-AppCloud
The TestDrive sample application provides you with a near blank template to get started with. It is great for learning and trying Kinvey, or to build your first application upon.

## Run It
After downloading or cloning the repository:

* Make sure you have an [App Cloud account](https://appcloud.brightcove.com), and the [App Cloud SDK](https://appcloud.brightcove.com) installed.
* Copy the `TestDrive` folder containing all code into the `appcloud-server/public` folder.
* Replace `<your-app-key>` and `<your-app-secret>` (lines 15–16 in `javascripts/views/ping.js`) with your application credentials.
* Run the App Cloud server:
```bash
node appcloud-server/app.js
```
* Point your browser to `http://localhost:3773`.
* Navigate to `TestDrive`, and click the `ping` view:
![Click ping](https://raw.github.com/KinveyApps/TestDrive-AppCloud/master/screenshot-view.png)

## Functionality
This application demonstrates:

* Basic set-up for App Cloud apps using Kinvey
* Pinging the service

## Architecture
The TestDrive app pings the Kinvey service. Therefore, the only view of the app is named `ping`. The HTML code is contained in `TestDrive/html/ping.html`. The associated JavaScript file is `TestDrive/javascripts/views/ping.js`. Here, Kinvey is initialized for use with your app.

The template of the page can be found in the `txt/markup` directory. The best place to learn how to extend the app is at the [App Cloud Documentation](http://support.brightcove.com/en/app-cloud) pages.