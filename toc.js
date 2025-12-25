// Populate the sidebar
//
// This is a script, and not included directly in the page, to control the total size of the book.
// The TOC contains an entry for each page, so if each page includes a copy of the TOC,
// the total size of the page becomes O(n**2).
class MDBookSidebarScrollbox extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.innerHTML = '<ol class="chapter"><li class="chapter-item expanded "><a href="md.html"><strong aria-hidden="true">1.</strong> Техническая документация</a></li><li class="chapter-item expanded "><a href="c4.html"><strong aria-hidden="true">2.</strong> C4</a></li><li><ol class="section"><li class="chapter-item expanded "><a href="C4/access-control-service.html"><strong aria-hidden="true">2.1.</strong> Сервис контроля доступа</a></li><li class="chapter-item expanded "><a href="C4/recognition-service.html"><strong aria-hidden="true">2.2.</strong> Сервис распознавания</a></li></ol></li><li class="chapter-item expanded "><a href="idef0.html"><strong aria-hidden="true">3.</strong> IDEF0</a></li><li class="chapter-item expanded "><a href="idef3.html"><strong aria-hidden="true">4.</strong> IDEF3</a></li><li class="chapter-item expanded "><a href="dfd.html"><strong aria-hidden="true">5.</strong> DFD</a></li><li class="chapter-item expanded "><a href="uml.html"><strong aria-hidden="true">6.</strong> UML</a></li><li><ol class="section"><li class="chapter-item expanded "><a href="UML/uml-registration.html"><strong aria-hidden="true">6.1.</strong> Регистрация</a></li><li class="chapter-item expanded "><a href="UML/uml-recognition.html"><strong aria-hidden="true">6.2.</strong> Распознавание</a></li></ol></li><li class="chapter-item expanded "><a href="bpmn.html"><strong aria-hidden="true">7.</strong> BPMN</a></li><li class="chapter-item expanded "><a href="adr.html"><strong aria-hidden="true">8.</strong> ADR</a></li><li><ol class="section"><li class="chapter-item expanded "><a href="ADR/30_adr_database_choice.html"><strong aria-hidden="true">8.1.</strong> Выбор базы данных</a></li><li class="chapter-item expanded "><a href="ADR/31_adr_kafka_broker.html"><strong aria-hidden="true">8.2.</strong> Выбор брокера сообщений</a></li><li class="chapter-item expanded "><a href="ADR/32_adr_ml_models.html"><strong aria-hidden="true">8.3.</strong> Выбор модели ML</a></li></ol></li><li class="chapter-item expanded "><a href="swagger.html"><strong aria-hidden="true">9.</strong> Swagger</a></li></ol>';
        // Set the current, active page, and reveal it if it's hidden
        let current_page = document.location.href.toString().split("#")[0].split("?")[0];
        if (current_page.endsWith("/")) {
            current_page += "index.html";
        }
        var links = Array.prototype.slice.call(this.querySelectorAll("a"));
        var l = links.length;
        for (var i = 0; i < l; ++i) {
            var link = links[i];
            var href = link.getAttribute("href");
            if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                link.href = path_to_root + href;
            }
            // The "index" page is supposed to alias the first chapter in the book.
            if (link.href === current_page || (i === 0 && path_to_root === "" && current_page.endsWith("/index.html"))) {
                link.classList.add("active");
                var parent = link.parentElement;
                if (parent && parent.classList.contains("chapter-item")) {
                    parent.classList.add("expanded");
                }
                while (parent) {
                    if (parent.tagName === "LI" && parent.previousElementSibling) {
                        if (parent.previousElementSibling.classList.contains("chapter-item")) {
                            parent.previousElementSibling.classList.add("expanded");
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }
        // Track and set sidebar scroll position
        this.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
                sessionStorage.setItem('sidebar-scroll', this.scrollTop);
            }
        }, { passive: true });
        var sidebarScrollTop = sessionStorage.getItem('sidebar-scroll');
        sessionStorage.removeItem('sidebar-scroll');
        if (sidebarScrollTop) {
            // preserve sidebar scroll position when navigating via links within sidebar
            this.scrollTop = sidebarScrollTop;
        } else {
            // scroll sidebar to current active section when navigating via "next/previous chapter" buttons
            var activeSection = document.querySelector('#sidebar .active');
            if (activeSection) {
                activeSection.scrollIntoView({ block: 'center' });
            }
        }
        // Toggle buttons
        var sidebarAnchorToggles = document.querySelectorAll('#sidebar a.toggle');
        function toggleSection(ev) {
            ev.currentTarget.parentElement.classList.toggle('expanded');
        }
        Array.from(sidebarAnchorToggles).forEach(function (el) {
            el.addEventListener('click', toggleSection);
        });
    }
}
window.customElements.define("mdbook-sidebar-scrollbox", MDBookSidebarScrollbox);
