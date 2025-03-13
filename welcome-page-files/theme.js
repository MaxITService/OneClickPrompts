document.addEventListener('DOMContentLoaded', function() {
  // Automatically activate dark theme if the OS is set to dark mode
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.body.classList.add('dark-theme');
    // If the toggle exists, set it to "on"
    var darkToggle = document.getElementById('darkThemeToggle');
    if (darkToggle) {
      darkToggle.checked = true;
    }
  }
  
  // Handler for manually toggling the theme
  var darkThemeToggle = document.getElementById('darkThemeToggle');
  if(darkThemeToggle) {
    darkThemeToggle.addEventListener('change', function() {
      if(this.checked) {
        document.body.classList.add('dark-theme');
      } else {
        document.body.classList.remove('dark-theme');
      }
    });
  }
});
