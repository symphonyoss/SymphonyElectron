const titleBar = (`
<div id="title-bar">
    <div class="title-bar-button-container">
        <button title="Menu" id='hamburger-menu-button'>
            <svg x='0px' y='0px' viewBox='0 0 10.2 10.2'>
                    <rect fill="white" width='10' height='1'/>
                    <rect fill="white" y='4' width='10.2' height='1'/>
                    <rect fill="white" y='8' width='10.2' height='1'/>
              </svg>
        </button>
    </div>
    <div id="title-container">
        <span id="title-bar-title">
            Symphony
        </span>
    </div>
</div>
`);

const button = (`
<div class="action-items">
<div class="title-bar-button-container">
<button class="title-bar-button" id="title-bar-minimize-button" title='Minimize'>
  <svg x='0px' y='0px' viewBox='0 0 10.2 1'>
    <rect fill="white" width='10.2' height='1' />
  </svg>
</button>
</div>
<div class="title-bar-button-container">
<button class="title-bar-button" id="title-bar-maximize-button" title='Maximize'>
    <svg x='0px' y='0px' viewBox='0 0 10.2 10.2'>
        <path
            fill='white'
            d='M0,0v10.1h10.2V0H0z M9.2,9.2H1.1V1h8.1V9.2z'
        />
    </svg>
</button>
</div>
<div class="title-bar-button-container">
<button class="title-bar-button" id="title-bar-close-button" title='Close'>
  <svg x='0px' y='0px' viewBox='0 0 10.2 10.2'>
    <polygon
      fill="white"
      points='10.2,0.7 9.5,0 5.1,4.4 0.7,0 0,0.7 4.4,5.1 0,9.5 0.7,10.2 5.1,5.8 9.5,10.2 10.2,9.5 5.8,5.1 '
    />
  </svg>
</button>
</div>
</div>
`);

const unMaximizeButton = (`
<svg x='0px' y='0px' viewBox='0 0 10.2 10.2'>
   <path
      fill='white'
      d='M2.1,0v2H0v8.1h8.2v-2h2V0H2.1z M7.2,9.2H1.1V3h6.1V9.2z M9.2,7.1h-1V2H3.1V1h6.1V7.1z'
      />
</svg>
`);

const maximizeButton = (`
<svg x='0px' y='0px' viewBox='0 0 10.2 10.2'>
   <path
      fill='white'
      d='M0,0v10.1h10.2V0H0z M9.2,9.2H1.1V1h8.1V9.2z'
      />
</svg>
`);


module.exports = {
    titleBar: titleBar,
    button: button,
    unMaximizeButton: unMaximizeButton,
    maximizeButton: maximizeButton
};