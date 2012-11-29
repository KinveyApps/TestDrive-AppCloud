( function( $ ) {

  /*
   * The Brightcove SDK will fire an "init" event after the document is ready, the device is ready to be interacted with and any
   * locale or markup files have been loaded and populated on the bc.templates object.
   */
  $( bc ).bind( "init", initialize );
  
  function initialize() {
    registerEventListeners();
    setContentOfPage();

    // Configure.
    Kinvey.init({
      appKey: '<your-app-key>',
      appSecret: '<your-app-secret>'
    });
  }
  
  /**
   * Any event listeners we need for this view we setup here.  Note that the elements we are binding to are not yet 
   * created which is why we use the delegate syntax.
   */
  function registerEventListeners() {
    $('#ping-content').on('click', '#ping', function() {
      Kinvey.ping({
        success: function(response) {
          alert('Kinvey Ping Success. Kinvey Service is alive, version: ' + response.version + ', response: ' + response.kinvey);
        },
        error: function(error) {
          alert('Kinvey Ping Failed. Response: ' + error.description);
        }
      });
    });
  }
  
  /**
   * Sets the content of the first page.  In theory you will have fetched data from the appcloud server using bc.core.getData 
   * and now you will generate HTML markup using the built in markup templating library.  Here we are simply using the static data
   * we defined at the top file and passing that to the markup associated with this view.  This association happens in the 
   * manifest.json file.  However, you can use as much or as little of our SDK as you choose, so you could also simply fetch data 
   * directly from your server and then set the content here.
   */
  function setContentOfPage() {
    //The SDK automatically parses any templates you associate with this view on the bc.templates object.
    var template = bc.templates["ping-tmpl"];

    //The generated HTML for this template.
    var html = Mark.up( template, { } );
    
    //Set the HTML of the element.
    $( "#ping-content" ).html( html );
  }
  
})( jQuery )