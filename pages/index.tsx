import React, { useState } from "react";
import { motion } from "framer-motion";
import Head from "next/head";
import { Navigation } from "../components/Navigation/Navigation";
import ReactGa from "react-ga";

interface indexProps {}

const transition: { duration: number; ease: number[] } = {
  duration: 1.4,
  ease: [0.6, 0.01, -0.05, 0.9],
};

const locomotiveScroll =
  typeof window !== `undefined` ? require("locomotive-scroll").default : null;

const hoverEffect =
  typeof window !== `undefined` ? require("hover-effect").default : null;



const index: React.FC<indexProps> = ({}) => {
  const [speakerState, setSpeakerState] = useState("muted");
  const [isToggleOpen, setIsToggleOpen] = useState<boolean>(false);


  const refScroll = React.useRef(null);
  let lscroll: any;

  React.useEffect(() => {
    ReactGa.initialize("UA-177100391-3");
    ReactGa.pageview(window.location.pathname + window.location.search);

    if (!refScroll.current) return;
    // @ts-ignore
    lscroll = new locomotiveScroll({
      el: refScroll.current,
      smooth: true,
      reloadOnContextChange: true,
      multiplier: 0.75,
      inertia: 0.5,
    });

    // update locomotive scroll
    window.addEventListener("load", () => {
      let image = document.querySelector("img");
      // @ts-ignore
      const isLoaded = image!.complete && image!.naturalHeight !== 0;
      lscroll.update();
    });
    // image hover effect
    Array.from(document.querySelectorAll(".project-card__middle")).forEach(
      (el: any) => {
        const imgs: any = Array.from(el.querySelectorAll("img"));
        new hoverEffect({
          parent: el,
          intensity: 0.2,
          speedIn: el.dataset.speedin || undefined,
          speedOut: el.dataset.speedout || undefined,
          easing: el.dataset.easing || undefined,
          hover: el.dataset.hover || undefined,
          image1: imgs[0].getAttribute("src"),
          image2: imgs[1].getAttribute("src"),
          displacementImage: el.dataset.displacement,
        });
      }
    );

    // // header cursor
    // const cursor = document.querySelector(".cursor");
    // window.onmousemove = (e: any) => {
    //   cursor!.setAttribute("style", `top: ${e.pageY}px; left: ${e.pageX}px;`);
    // };

    console.clear();
  }, []);

  const handleSpeaker = () => {
    const audio = document.querySelector("#audioPlayer") as HTMLVideoElement;

    if (speakerState === "muted") {
      setSpeakerState("unmuted");
      audio.pause();
    } else {
      setSpeakerState("muted");
      audio.play();
    }
  };

  function toggleBodyScroll(isToggleOpen: boolean) {
    if (isToggleOpen === false) {
      setIsToggleOpen(true);
    } else if (isToggleOpen === true) {
      setIsToggleOpen(false);
    }
  }
  const isTouchScreenDevice = () => {
    try {
      document.createEvent("TouchEvent");
      return true;
    } catch (e) {
      return false;
    }
  };
  const isMobileScreen = isTouchScreenDevice();
  return (
    <>
      <div id="menu-target" data-scroll-container ref={refScroll}>
        <Head>
          <link rel="icon" href="svg/favicon.svg" />
          <link href="https://keerthangopalakrishnan.xyz/" rel="canonical" />
          <meta name="theme-color" content="#10101A" />
          <meta
            name="apple-mobile-web-app-status-bar-style"
            content="#10101A"
          />
          <title>Keerthan Gopalakrishnan &mdash; Backend Devloper</title>
          <meta
            name="description"
            content="I'm a self-taught Backend Developer and turning ideas into real life products is my calling."
          />
          <meta property="og:type" content="website" />
          <meta
            property="og:title"
            content="Keerthan Gopalalrishnan &mdash; Backend Developer"
          />
          <meta
            property="og:url"
            content="https://keerthangopalakrishnan.xyz/"
          />
          <meta property="og:image" content="webp/preview-image.png" />
          <meta
            property="og:description"
            content="I'm a self-taught Front End Developer and turning ideas into real life products is my calling."
          />
          <meta
            name="twitter:title"
            content="Keerthan Gopalalrishnan &mdash; Backend Developer"
          />
        </Head>
        <audio loop id="audioPlayer" autoPlay style={{ display: "none" }}>
          <source src="sound/preloader.mp3" type="audio/mp3" />
        </audio>
        <motion.div
          data-scroll
          data-scroll-sticky
          data-scroll-target="#menu-target"
          animate={{ top: "-100vh", transition: { ...transition, delay: 9 } }}
          className="preloader"
        >
          <div className="preloader__wrapper">
            <motion.div
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1, transition: { ...transition } }}
              className="preloader__left"
            >
              <img src="svg/keerthan-logo-left.svg" alt="keerthan logo" />
            </motion.div>
            <motion.div
              initial={{ x: 10, opacity: 0 }}
              animate={{ x: 0, opacity: 1, transition: { ...transition } }}
              className="preloader__right"
            >
              <p className="preloader__text">Spring Boot</p>
              <p className="preloader__text">React Native</p>
              <p className="preloader__text">React JS</p>
              <p className="preloader__text">Django</p>
              <p className="preloader__text">Ruby on Rails</p>
            </motion.div>
          </div>
        </motion.div>
        {/* <div className="cursor"></div> */}
        <Navigation
          isOpen={isToggleOpen}
          toggleOpen={() => toggleBodyScroll(isToggleOpen)}
        />
        <div className="header-wrapper">
          <header className="header">
            <div className="header__hero">
              <div className="header__hero--heading">
                <span>turning ideas into </span> <br />
                <span>real life </span>
                <span className="header__hero--heading-gradient">
                  products{" "}
                </span>
                <br />
                <span>is my calling.</span>
              </div>
              <a
                data-scroll-to
                className="header__hero--cta"
                href="#sectionProjects"
              >
                VIEW PROJECTS
              </a>
            </div>
          </header>
          <div className="header__footer">
            <div className="header__footer--left">
              <div className="speaker">
                <div
                  onClick={handleSpeaker}
                  className={`${"speaker__toggle"} ${
                    speakerState === "unmuted"
                      ? `${"speaker__toggle--anim"}`
                      : ``
                  }`}
                >
                  &nbsp;
                </div>
                <div className="speaker__muted">
                  <img src="svg/muted.svg" alt="muted icon" />
                </div>
                <div className="speaker__unmuted">
                  <svg
                    width="14"
                    height="11"
                    viewBox="0 0 15 11"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect
                      x="0.599976"
                      y="1.06665"
                      width="1.4"
                      height="10"
                      fill="#F2F2F2"
                      className="rect1-anim"
                    />
                    <rect
                      x="9"
                      y="1.06665"
                      width="1.4"
                      height="10"
                      fill="#F2F2F2"
                      className="rect2-anim"
                    />
                    <rect
                      x="4.79999"
                      y="1.06665"
                      width="1.4"
                      height="10"
                      fill="#F2F2F2"
                      className="rect3-anim"
                    />
                    {/* <rect
                      x="13.2"
                      y="1.06665"
                      width="1.4"
                      height="10"
                      fill="#F2F2F2"
                      className="rect4-anim"
                    /> */}
                  </svg>
                </div>
              </div>
            </div>
            <div className="header__footer--right">
              <a href="/resume/resume.pdf" rel="noopener" target="_blank">
                📄 RE
              </a>
              <a
                href="https://github.com/keerthan44"
                rel="noopener"
                target="_blank"
              >
                👾 GH
              </a>
              <a
                href="https://www.linkedin.com/in/keerthan44"
                rel="noopener"
                target="_blank"
              >
                💼 LD
              </a>
            </div>
          </div>
        </div>
        <main className="container">
          <p className="about-text">
            Hello stranger! 👋, my name is Keerthan and I am a backend engineer,
            passionate <br /> about products that posses a challenge.
          </p>
          <section id="sectionProjects" className="section-projects">
            <h1 className="heading-1">
              <span>Yeah, I work hard </span> <small>💼</small>
            </h1>
            <p className="paragraph">
              Each project is unique. Here are some of my works.
            </p>

            <div className="project-card">
              <div className="project-card__left">
                <h4 className="heading-4">
                  SPRING BOOT, REACT NATIVE, LIQUIBASE
                </h4>
              </div>
              <div
                className="project-card__middle"
                data-displacement="webp/myDistorsionImage.webp"
              >
                <img src="webp/moneysplit-1.webp" alt="Moneysplit" />
                <img src="webp/moneysplit-2.webp" alt="Moneysplit Logo" />
              </div>
              <div className="project-card__right">
                <h2
                  data-scroll
                  data-scroll-offset="35%"
                  data-scroll-repeat={true}
                  data-scroll-class="alexxandria-anim"
                  className="heading-2"
                >
                  Moneysplit
                </h2>
                <p className="project-card__paragraph">
                  App to split bills with friends and family.
                </p>
              </div>
            </div>

            <div className="project-card">
              <div className="project-card__left">
                <h4 className="heading-4">ARDUINO IDE</h4>
              </div>
              <div
                className="project-card__middle"
                data-displacement="webp/myDistorsionImage.webp"
              >
                <img src="webp/safarika-1.webp" alt="battleBots" />
                <img src="webp/battleBots-2.webp" alt="battleBots logo" />
              </div>
              <div className="project-card__right">
                <h2
                  data-scroll
                  data-scroll-offset="35%"
                  data-scroll-repeat={true}
                  data-scroll-class="safarika-anim"
                  className="heading-2"
                >
                  Battle of Bots (TAS)
                </h2>
                <p className="project-card__paragraph">
                  Built and operated a remoted-controlled{" "}
                  {!isMobileScreen && <br />}
                  machine that was designed to fight in an{" "}
                  {!isMobileScreen && <br />} arena combat elimination
                  tournament.
                </p>
                <div className="project-card__socials">
                  <a
                    rel="noopener"
                    target="_blank"
                    href="https://github.com/keerthan44/battleBot"
                  >
                    <img src="svg/github.svg" alt="github icon" />
                  </a>
                </div>
              </div>
            </div>

            <div className="project-card">
              <div className="project-card__left">
                <h4 className="heading-4">React Native, Arduino IDE</h4>
              </div>
              <div
                className="project-card__middle"
                data-displacement="webp/myDistorsionImage.webp"
              >
                <img src="webp/cisco-1.webp" alt="heatrow" />
                <img src="webp/cisco-2.webp" alt="heatrow logo" />
              </div>
              <div className="project-card__right">
                <h2
                  data-scroll
                  data-scroll-offset="35%"
                  data-scroll-repeat={true}
                  data-scroll-class="heatrow-anim"
                  className="heading-2"
                >
                  Alzheimer Patient
                  <br /> Locator
                </h2>
                <p className="project-card__paragraph">
                  Built and operated a standalone {!isMobileScreen && <br />}
                  device for people with alzheimer.
                  {!isMobileScreen && <br />}
                  patients' location.
                </p>
                <div className="project-card__socials">
                  <a
                    rel="noopener"
                    target="_blank"
                    href="https://github.com/keerthan44/AlzheimerPatientLocator"
                  >
                    <img src="svg/github.svg" alt="github icon" />
                  </a>
                </div>
              </div>
            </div>
          </section>
          <section className="section-contact">
            <h1 className="heading-1">
              <span>Sold Yet? </span> <small>🤙</small>
            </h1>
            <h2 className="section-contact__h2">
              Thanks for stopping by, I’m currently looking to join a team of
              developers. Here is my
              <a
                href="/resume/resume.pdf"
                target="_blank"
                rel="noopener noreferrer"
              >
                {" "}
                resume 📄.{" "}
              </a>
              &nbsp;If you think we might be a good fit for one another, give me
              a<a href="tel:+917676724337"> call 🇳🇬 &nbsp;</a>
              or send me an
              <a
                href="https://mail.google.com/mail/u/0/?fs=1&tf=cm&source=mailto&su=&to=keerthan44@gmail.com&bcc=&body="
                target="_blank"
                rel="noopener noreferrer"
              >
                &nbsp; email 📧
              </a>
              .
            </h2>
          </section>
          <section className="section-socials">
            <h1 className="heading-1">
              <span>Dont be a stranger!</span> <small>👋</small>
            </h1>
            <p className="paragraph">Connect with me online</p>
            <div className="section-socials--links">
              <a href="/resume/resume.pdf" rel="noopener" target="_blank">
                📄 RESUME
              </a>
              <a
                href="https://github.com/keerthan44"
                rel="noopener"
                target="_blank"
              >
                👾 GitHub
              </a>
              <a
                href="https://www.linkedin.com/in/keerthan44"
                rel="noopener"
                target="_blank"
              >
                💼 LinkedIn
              </a>
            </div>
          </section>
        </main>
        <footer className="footer">
          <img
            src="svg/keerthan-logo-footer.svg"
            alt="design and devloped by Keerthan"
          />
          <div className="footer__socials">
            <a
              href="https://github.com/keerthan44/personal-website"
              target="_blank"
              rel="noopener"
            >
              <img src="svg/github.svg" alt="github logo" />
            </a>
          </div>
        </footer>
      </div>
    </>
  );
};

export default index;
