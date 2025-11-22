export default {
  config: {
   
    locales: ['en','tr'], // optional, if you have translations
    theme: {
      colors: {
        primary100: '#f0f9ff',
        primary200: '#e0f2fe',
        primary500: '#3b82f6',
        primary600: '#2563eb',
        primary700: '#1d4ed8',
        danger700: '#b91c1c',
      },
    },
    notifications: { release: false },
    translations: {
      en: {
        // Top-left brand title in the navigation menu
        'app.components.LeftMenu.navbrand.title': 'My Brand Name', 
        
        // Subtitle below the brand title
        'app.components.LeftMenu.navbrand.workplace': 'Content Studio',
        
        // Login page welcome title
        'Auth.form.welcome.title': 'Antikor Sağlık', 
       /*  "app.components.WelcomePage.welcome": "Welcome to Antikor Dashboard 🚀",
        "app.components.WelcomePage.subtitle": "Manage your content and users with ease.", */
        // Login page welcome subtitle
        "HomePage.header.subtitle": "Antikor Sağlık yönetici paneline hoş geldiniz.",
        'Auth.form.welcome.subtitle': ' ', 
       
      },
      tr:{
        "HomePage.header.title": "Merhaba {name}",
         'Auth.form.welcome.title': 'Antikor Sağlık', 
       /*  "app.components.WelcomePage.welcome": "Welcome to Antikor Dashboard 🚀",
        "app.components.WelcomePage.subtitle": "Manage your content and users with ease.", */
        // Login page welcome subtitle
        "HomePage.header.subtitle": "Antikor Sağlık yönetici paneline hoş geldiniz.",
        'Auth.form.welcome.subtitle': ' ', 
        "global.home": "Anasayfa",
        "global.content-manager": 'İçerik Yönetimi1',
        "global.plugins.content-manager": "Content Manager1",
        "Content Manager": "İçerik Yönetimi1",
        "tours.contentManager.Introduction.title": "Content manager1",
      }
      // You can add other locales (e.g., 'fr', 'de') here
    },
  },
  bootstrap() {},
};
